import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extract } from "../stream-extractor.js";

// helper to create minimal valid zip files with specific characteristics
function createMaliciousZip(options: {
	filename: string;
	content?: string;
	corruptCrc?: boolean;
}): Buffer {
	const { filename, content = "test content", corruptCrc = false } = options;

	const fileData = Buffer.from(content, "utf-8");
	const actualCrc = crc32(fileData);
	const crc = corruptCrc ? (actualCrc + 1) >>> 0 : actualCrc;

	// local file header
	const lfhSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
	const lfhVersion = Buffer.from([0x14, 0x00]);
	const lfhFlags = Buffer.from([0x00, 0x00]);
	const lfhCompression = Buffer.from([0x00, 0x00]); // stored
	const lfhModTime = Buffer.from([0x00, 0x00]);
	const lfhModDate = Buffer.from([0x21, 0x00]);
	const lfhCrc32 = Buffer.allocUnsafe(4);
	lfhCrc32.writeUInt32LE(crc);
	const lfhCompressedSize = Buffer.allocUnsafe(4);
	lfhCompressedSize.writeUInt32LE(fileData.length);
	const lfhUncompressedSize = Buffer.allocUnsafe(4);
	lfhUncompressedSize.writeUInt32LE(fileData.length);
	const filenameBytes = Buffer.from(filename, "utf-8");
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
	const cdhFlags = Buffer.from([0x00, 0x00]);
	const cdhCompression = Buffer.from([0x00, 0x00]);
	const cdhModTime = Buffer.from([0x00, 0x00]);
	const cdhModDate = Buffer.from([0x21, 0x00]);
	const cdhCrc32 = Buffer.allocUnsafe(4);
	cdhCrc32.writeUInt32LE(crc);
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

describe("security tests", () => {
	it("should reject path traversal with ../", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const maliciousZip = createMaliciousZip({
				filename: "../../../etc/malicious.txt",
			});

			const zipPath = join(tmpDir, "malicious.zip");
			await writeFile(zipPath, maliciousZip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await expect(extract(zipPath, extractPath)).rejects.toThrow(
				/path traversal/i,
			);
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should allow absolute paths but treat them as relative", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const maliciousZip = createMaliciousZip({
				filename: "/etc/malicious.txt",
				content: "absolute path content",
			});

			const zipPath = join(tmpDir, "malicious.zip");
			await writeFile(zipPath, maliciousZip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			// absolute paths should be stripped and treated as relative
			await extract(zipPath, extractPath);

			const extractedContent = await readFile(
				join(extractPath, "etc/malicious.txt"),
				"utf-8",
			);
			expect(extractedContent).toBe("absolute path content");
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should reject path traversal with mixed separators", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const maliciousZip = createMaliciousZip({
				filename: "..\\..\\..\\malicious.txt",
			});

			const zipPath = join(tmpDir, "malicious.zip");
			await writeFile(zipPath, maliciousZip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await expect(extract(zipPath, extractPath)).rejects.toThrow(
				/path traversal/i,
			);
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should reject corrupted crc32", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const maliciousZip = createMaliciousZip({
				filename: "test.txt",
				content: "valid content",
				corruptCrc: true,
			});

			const zipPath = join(tmpDir, "corrupt-crc.zip");
			await writeFile(zipPath, maliciousZip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await expect(extract(zipPath, extractPath)).rejects.toThrow(/crc32/i);
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("should allow valid relative paths", async () => {
		const tmpDir = join(tmpdir(), `unzip-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			const validZip = createMaliciousZip({
				filename: "subdir/valid.txt",
				content: "safe content",
			});

			const zipPath = join(tmpDir, "valid.zip");
			await writeFile(zipPath, validZip);

			const extractPath = join(tmpDir, "extract");
			await mkdir(extractPath, { recursive: true });

			await extract(zipPath, extractPath);

			const extractedContent = await readFile(
				join(extractPath, "subdir/valid.txt"),
				"utf-8",
			);
			expect(extractedContent).toBe("safe content");
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});








