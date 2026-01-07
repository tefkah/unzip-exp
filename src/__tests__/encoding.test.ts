import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extract } from "../stream-extractor.js";

// helper to create zip with specific encoding flags
function createEncodedZip(options: {
	filename: string;
	content: string;
	useUtf8Flag?: boolean;
	encoding?: BufferEncoding;
}): Buffer {
	const {
		filename,
		content,
		useUtf8Flag = false,
		encoding = "utf-8",
	} = options;

	const fileData = Buffer.from(content, "utf-8");
	const fileCrc = crc32(fileData);
	const filenameBytes = Buffer.from(filename, encoding);

	// local file header
	const lfhSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
	const lfhVersion = Buffer.from([0x14, 0x00]);
	const lfhFlags = Buffer.allocUnsafe(2);
	lfhFlags.writeUInt16LE(useUtf8Flag ? 0x0800 : 0x0000); // set utf-8 flag
	const lfhCompression = Buffer.from([0x00, 0x00]); // stored
	const lfhModTime = Buffer.from([0x00, 0x00]);
	const lfhModDate = Buffer.from([0x21, 0x00]);
	const lfhCrc32 = Buffer.allocUnsafe(4);
	lfhCrc32.writeUInt32LE(fileCrc);
	const lfhCompressedSize = Buffer.allocUnsafe(4);
	lfhCompressedSize.writeUInt32LE(fileData.length);
	const lfhUncompressedSize = Buffer.allocUnsafe(4);
	lfhUncompressedSize.writeUInt32LE(fileData.length);
	const lfhFilenameLength = Buffer.allocUnsafe(2);
	lfhFilenameLength.writeUInt16LE(filenameBytes.length);
	const lfhExtraLength = Buffer.from([0x00, 0x00]);

	const localFileHeader = Buffer.concat([
		lfhSignature,
		lfhVersion,
		lfhFlags,
		lfhCompression,
		lfhModTime,
		lfhModDate,
		lfhCrc32,
		lfhCompressedSize,
		lfhUncompressedSize,
		lfhFilenameLength,
		lfhExtraLength,
		filenameBytes,
		fileData,
	]);

	const localHeaderOffset = 0;

	// central directory header
	const cdhSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
	const cdhVersionMadeBy = Buffer.from([0x14, 0x00]);
	const cdhVersionNeeded = Buffer.from([0x14, 0x00]);
	const cdhFlags = Buffer.allocUnsafe(2);
	cdhFlags.writeUInt16LE(useUtf8Flag ? 0x0800 : 0x0000);
	const cdhCompression = Buffer.from([0x00, 0x00]);
	const cdhModTime = Buffer.from([0x00, 0x00]);
	const cdhModDate = Buffer.from([0x21, 0x00]);
	const cdhCrc32 = Buffer.allocUnsafe(4);
	cdhCrc32.writeUInt32LE(fileCrc);
	const cdhCompressedSize = Buffer.allocUnsafe(4);
	cdhCompressedSize.writeUInt32LE(fileData.length);
	const cdhUncompressedSize = Buffer.allocUnsafe(4);
	cdhUncompressedSize.writeUInt32LE(fileData.length);
	const cdhFilenameLength = Buffer.allocUnsafe(2);
	cdhFilenameLength.writeUInt16LE(filenameBytes.length);
	const cdhExtraLength = Buffer.from([0x00, 0x00]);
	const cdhCommentLength = Buffer.from([0x00, 0x00]);
	const cdhDiskStart = Buffer.from([0x00, 0x00]);
	const cdhInternalAttrs = Buffer.from([0x00, 0x00]);
	const cdhExternalAttrs = Buffer.from([0x00, 0x00, 0x00, 0x00]);
	const cdhLocalHeaderOffset = Buffer.allocUnsafe(4);
	cdhLocalHeaderOffset.writeUInt32LE(localHeaderOffset);

	const centralDirectoryHeader = Buffer.concat([
		cdhSignature,
		cdhVersionMadeBy,
		cdhVersionNeeded,
		cdhFlags,
		cdhCompression,
		cdhModTime,
		cdhModDate,
		cdhCrc32,
		cdhCompressedSize,
		cdhUncompressedSize,
		cdhFilenameLength,
		cdhExtraLength,
		cdhCommentLength,
		cdhDiskStart,
		cdhInternalAttrs,
		cdhExternalAttrs,
		cdhLocalHeaderOffset,
		filenameBytes,
	]);

	const centralDirectoryOffset = localFileHeader.length;

	// end of central directory
	const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
	const eocdDiskNumber = Buffer.from([0x00, 0x00]);
	const eocdCentralDirDisk = Buffer.from([0x00, 0x00]);
	const eocdEntriesOnDisk = Buffer.from([0x01, 0x00]);
	const eocdTotalEntries = Buffer.from([0x01, 0x00]);
	const eocdCentralDirSize = Buffer.allocUnsafe(4);
	eocdCentralDirSize.writeUInt32LE(centralDirectoryHeader.length);
	const eocdCentralDirOffset = Buffer.allocUnsafe(4);
	eocdCentralDirOffset.writeUInt32LE(centralDirectoryOffset);
	const eocdCommentLength = Buffer.from([0x00, 0x00]);

	const endOfCentralDirectory = Buffer.concat([
		eocdSignature,
		eocdDiskNumber,
		eocdCentralDirDisk,
		eocdEntriesOnDisk,
		eocdTotalEntries,
		eocdCentralDirSize,
		eocdCentralDirOffset,
		eocdCommentLength,
	]);

	return Buffer.concat([
		localFileHeader,
		centralDirectoryHeader,
		endOfCentralDirectory,
	]);
}

describe("encoding tests", () => {
	it("should handle utf-8 filenames with flag set", async () => {
		const tmpDir = join(
			tmpdir(),
			`unzip-test-utf8-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tmpDir, { recursive: true });

		try {
			const utf8Zip = createEncodedZip({
				filename: "test-文件.txt",
				content: "utf-8 content",
				useUtf8Flag: true,
				encoding: "utf-8",
			});

			const zipPath = join(tmpDir, "utf8.zip");
			await writeFile(zipPath, utf8Zip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await extract(zipPath, extractPath);

			// wait for filesystem to sync (macOS can be slow with unicode filenames)
			await new Promise((resolve) => setTimeout(resolve, 50));

			const extractedContent = await readFile(
				join(extractPath, "test-文件.txt"),
				"utf-8",
			);
			expect(extractedContent).toBe("utf-8 content");
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should handle latin1 filenames without utf-8 flag", async () => {
		const tmpDir = join(
			tmpdir(),
			`unzip-test-latin1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tmpDir, { recursive: true });

		try {
			const latin1Zip = createEncodedZip({
				filename: "test-café.txt",
				content: "latin1 content",
				useUtf8Flag: false,
				encoding: "latin1",
			});

			const zipPath = join(tmpDir, "latin1.zip");
			await writeFile(zipPath, latin1Zip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await extract(zipPath, extractPath);

			// wait for filesystem to sync
			await new Promise((resolve) => setTimeout(resolve, 50));

			const extractedContent = await readFile(
				join(extractPath, "test-café.txt"),
				"utf-8",
			);
			expect(extractedContent).toBe("latin1 content");
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});








