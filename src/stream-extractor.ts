import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";
import {
	COMPRESSION_DEFLATE,
	COMPRESSION_STORED,
	END_OF_CENTRAL_DIRECTORY_SIZE,
	LOCAL_FILE_HEADER_SIZE,
} from "./constants.js";
import {
	parseCentralDirectory,
	parseEndOfCentralDirectory,
	parseLocalFileHeader,
} from "./parser.js";
import type { ZipEntry } from "./types.js";

const MAX_CONCURRENT_EXTRACTIONS = 32;

export interface ExtractOptions {
	outputPath: string;
	overwrite?: boolean;
	concurrency?: number;
}

export async function extractZipStream(
	zipPath: string,
	options: ExtractOptions,
): Promise<void> {
	const {
		outputPath,
		overwrite = true,
		concurrency = MAX_CONCURRENT_EXTRACTIONS,
	} = options;

	const fileHandle = await open(zipPath, "r");
	try {
		const stats = await fileHandle.stat();
		const fileSize = stats.size;

		const eocdSearchSize = Math.min(
			65536 + END_OF_CENTRAL_DIRECTORY_SIZE,
			fileSize,
		);
		const eocdBuffer = Buffer.allocUnsafe(eocdSearchSize);
		await fileHandle.read(
			eocdBuffer,
			0,
			eocdSearchSize,
			fileSize - eocdSearchSize,
		);

		const eocdOffset = findEndOfCentralDirectory(eocdBuffer);
		if (eocdOffset === -1) {
			throw new Error("Could not find End of Central Directory");
		}

		const eocd = parseEndOfCentralDirectory(eocdBuffer.subarray(eocdOffset));

		const centralDirBuffer = Buffer.allocUnsafe(eocd.centralDirectorySize);
		await fileHandle.read(
			centralDirBuffer,
			0,
			eocd.centralDirectorySize,
			eocd.centralDirectoryOffset,
		);

		const centralDir = parseCentralDirectory(
			centralDirBuffer,
			eocd.entryCount,
			eocd.comment,
		);

		// batch create all directories first
		const directories = new Set<string>();
		for (const entry of centralDir.entries) {
			if (entry.isDirectory) {
				directories.add(join(outputPath, entry.filename));
			} else {
				directories.add(dirname(join(outputPath, entry.filename)));
			}
		}

		await Promise.all(
			Array.from(directories).map((dir) => mkdir(dir, { recursive: true })),
		);

		// extract files in parallel with concurrency limit
		const files = centralDir.entries.filter((e) => !e.isDirectory);

		await parallelLimit(files, concurrency, (entry) =>
			extractEntry(fileHandle, entry, outputPath, overwrite),
		);
	} finally {
		await fileHandle.close();
	}
}

async function parallelLimit<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	const results: Promise<void>[] = [];
	const executing: Promise<void>[] = [];

	for (const item of items) {
		const promise = fn(item);
		results.push(promise);

		if (limit <= items.length) {
			const executing_promise = promise.then(() => {
				executing.splice(executing.indexOf(executing_promise), 1);
			});
			executing.push(executing_promise);

			if (executing.length >= limit) {
				await Promise.race(executing);
			}
		}
	}

	await Promise.all(results);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
	for (let i = buffer.length - END_OF_CENTRAL_DIRECTORY_SIZE; i >= 0; i--) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			return i;
		}
	}
	return -1;
}

function sanitizePath(filename: string, outputPath: string): string {
	// remove leading slashes and normalize
	const normalizedFilename = filename.replace(/^[/\\]+/, "");

	// check for any parent directory references
	if (normalizedFilename.includes("..")) {
		throw new Error(`Path traversal attempt detected: ${filename}`);
	}

	// resolve the full path
	const targetPath = resolve(outputPath, normalizedFilename);
	const resolvedOutputPath = resolve(outputPath);

	// ensure the target path is within the output directory
	const relativePath = relative(resolvedOutputPath, targetPath);
	if (
		relativePath.startsWith(`..${sep}`) ||
		relativePath.startsWith(`..${sep === "/" ? "\\" : "/"}`)
	) {
		throw new Error(`Path traversal attempt detected: ${filename}`);
	}

	return targetPath;
}

async function extractEntry(
	fileHandle: import("fs/promises").FileHandle,
	entry: ZipEntry,
	outputPath: string,
	_overwrite: boolean,
): Promise<void> {
	const targetPath = sanitizePath(entry.filename, outputPath);

	const localHeaderBuffer = Buffer.allocUnsafe(LOCAL_FILE_HEADER_SIZE);
	await fileHandle.read(
		localHeaderBuffer,
		0,
		LOCAL_FILE_HEADER_SIZE,
		entry.localHeaderOffset,
	);

	const localHeader = parseLocalFileHeader(localHeaderBuffer);
	const dataOffset = entry.localHeaderOffset + localHeader.dataOffset;

	if (entry.compressedSize === 0) {
		const writeStream = createWriteStream(targetPath);
		writeStream.end();
		// validate empty file crc
		if (entry.crc32 !== 0) {
			await validateCrc32(targetPath, entry.crc32, 0);
		}
		return;
	}

	const readStream = createReadStream("", {
		fd: fileHandle.fd,
		start: dataOffset,
		end: dataOffset + entry.compressedSize - 1,
		autoClose: false,
		highWaterMark: 64 * 1024,
	});

	const writeStream = createWriteStream(targetPath, {
		highWaterMark: 64 * 1024,
	});

	if (entry.compressionMethod === COMPRESSION_STORED) {
		await pipeline(readStream, writeStream);
		// only validate crc if size > 0 to avoid reading empty files
		if (entry.uncompressedSize > 0) {
			await validateCrc32(targetPath, entry.crc32, entry.uncompressedSize);
		}
		return;
	}

	if (entry.compressionMethod === COMPRESSION_DEFLATE) {
		const inflateStream = createInflateRaw({
			chunkSize: 64 * 1024,
		});
		await pipeline(readStream, inflateStream, writeStream);
		// only validate crc if size > 0 to avoid reading empty files
		if (entry.uncompressedSize > 0) {
			await validateCrc32(targetPath, entry.crc32, entry.uncompressedSize);
		}
		return;
	}

	throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
}

async function validateCrc32(
	filePath: string,
	expectedCrc: number,
	expectedSize: number,
): Promise<void> {
	const buffer = await readFile(filePath);

	if (buffer.length !== expectedSize) {
		throw new Error(
			`Size mismatch for ${filePath}: expected ${expectedSize}, got ${buffer.length}`,
		);
	}

	const actualCrc = crc32(buffer);
	if (actualCrc !== expectedCrc) {
		throw new Error(
			`CRC32 mismatch for ${filePath}: expected ${expectedCrc}, got ${actualCrc}`,
		);
	}
}

// simplified api for common case
export async function extract(
	zipPath: string,
	outputPath: string,
): Promise<void> {
	await extractZipStream(zipPath, { outputPath });
}
