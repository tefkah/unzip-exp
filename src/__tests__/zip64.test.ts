import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extract } from "../stream-extractor.js";

// helper to create zip with zip64 extended information
function createZip64Zip(options: {
	filename: string;
	content: string;
	useZip64Size?: boolean;
	useZip64Offset?: boolean;
}): Buffer {
	const {
		filename,
		content,
		useZip64Size = true,
		useZip64Offset = false,
	} = options;

	const fileData = Buffer.from(content, "utf-8");
	const fileCrc = crc32(fileData);
	const filenameBytes = Buffer.from(filename, "utf-8");

	// create zip64 extra field
	const zip64ExtraField = Buffer.allocUnsafe(28);
	let zip64Offset = 0;

	// header id (0x0001)
	zip64ExtraField.writeUInt16LE(0x0001, zip64Offset);
	zip64Offset += 2;

	// data size (24 bytes: 8 for uncompressed + 8 for compressed + 8 for offset)
	zip64ExtraField.writeUInt16LE(24, zip64Offset);
	zip64Offset += 2;

	// uncompressed size (8 bytes)
	zip64ExtraField.writeBigUInt64LE(BigInt(fileData.length), zip64Offset);
	zip64Offset += 8;

	// compressed size (8 bytes)
	zip64ExtraField.writeBigUInt64LE(BigInt(fileData.length), zip64Offset);
	zip64Offset += 8;

	// local header offset (8 bytes)
	zip64ExtraField.writeBigUInt64LE(BigInt(0), zip64Offset);
	zip64Offset += 8;

	// local file header
	const lfhSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
	const lfhVersion = Buffer.from([0x2d, 0x00]); // version 4.5 for zip64
	const lfhFlags = Buffer.from([0x00, 0x00]);
	const lfhCompression = Buffer.from([0x00, 0x00]); // stored
	const lfhModTime = Buffer.from([0x00, 0x00]);
	const lfhModDate = Buffer.from([0x21, 0x00]);
	const lfhCrc32 = Buffer.allocUnsafe(4);
	lfhCrc32.writeUInt32LE(fileCrc);

	const lfhCompressedSize = Buffer.allocUnsafe(4);
	lfhCompressedSize.writeUInt32LE(useZip64Size ? 0xffffffff : fileData.length);

	const lfhUncompressedSize = Buffer.allocUnsafe(4);
	lfhUncompressedSize.writeUInt32LE(
		useZip64Size ? 0xffffffff : fileData.length,
	);

	const lfhFilenameLength = Buffer.allocUnsafe(2);
	lfhFilenameLength.writeUInt16LE(filenameBytes.length);

	const lfhExtraLength = Buffer.allocUnsafe(2);
	lfhExtraLength.writeUInt16LE(zip64ExtraField.length);

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
		zip64ExtraField,
		fileData,
	]);

	const localHeaderOffset = 0;

	// central directory header
	const cdhSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
	const cdhVersionMadeBy = Buffer.from([0x2d, 0x00]); // version 4.5
	const cdhVersionNeeded = Buffer.from([0x2d, 0x00]);
	const cdhFlags = Buffer.from([0x00, 0x00]);
	const cdhCompression = Buffer.from([0x00, 0x00]);
	const cdhModTime = Buffer.from([0x00, 0x00]);
	const cdhModDate = Buffer.from([0x21, 0x00]);
	const cdhCrc32 = Buffer.allocUnsafe(4);
	cdhCrc32.writeUInt32LE(fileCrc);

	const cdhCompressedSize = Buffer.allocUnsafe(4);
	cdhCompressedSize.writeUInt32LE(useZip64Size ? 0xffffffff : fileData.length);

	const cdhUncompressedSize = Buffer.allocUnsafe(4);
	cdhUncompressedSize.writeUInt32LE(
		useZip64Size ? 0xffffffff : fileData.length,
	);

	const cdhFilenameLength = Buffer.allocUnsafe(2);
	cdhFilenameLength.writeUInt16LE(filenameBytes.length);

	const cdhExtraLength = Buffer.allocUnsafe(2);
	cdhExtraLength.writeUInt16LE(zip64ExtraField.length);

	const cdhCommentLength = Buffer.from([0x00, 0x00]);
	const cdhDiskStart = Buffer.from([0x00, 0x00]);
	const cdhInternalAttrs = Buffer.from([0x00, 0x00]);
	const cdhExternalAttrs = Buffer.from([0x00, 0x00, 0x00, 0x00]);

	const cdhLocalHeaderOffset = Buffer.allocUnsafe(4);
	cdhLocalHeaderOffset.writeUInt32LE(
		useZip64Offset ? 0xffffffff : localHeaderOffset,
	);

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
		zip64ExtraField,
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

describe("zip64 support", () => {
	it("should extract zip64 file with extended size information", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const zip64Content = createZip64Zip({
				filename: "test.txt",
				content: "zip64 content",
				useZip64Size: true,
			});

			const zipPath = join(tmpDir, "zip64.zip");
			await writeFile(zipPath, zip64Content);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			// should successfully extract the file
			await expect(extract(zipPath, extractPath)).resolves.toBeUndefined();
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should extract zip64 file with extended offset information", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const zip64Content = createZip64Zip({
				filename: "test.txt",
				content: "zip64 offset",
				useZip64Size: true,
				useZip64Offset: true,
			});

			const zipPath = join(tmpDir, "zip64-offset.zip");
			await writeFile(zipPath, zip64Content);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await expect(extract(zipPath, extractPath)).resolves.toBeUndefined();
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});








