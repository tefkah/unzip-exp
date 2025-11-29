import { describe, expect, it } from "vitest";
import {
	CENTRAL_DIRECTORY_SIGNATURE,
	END_OF_CENTRAL_DIRECTORY_SIGNATURE,
} from "../constants.js";
import {
	parseCentralDirectory,
	parseEndOfCentralDirectory,
	parseLocalFileHeader,
} from "../parser.js";

describe("parseEndOfCentralDirectory", () => {
	it("should parse valid EOCD", () => {
		const buffer = Buffer.alloc(22);
		buffer.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
		buffer.writeUInt16LE(0, 4);
		buffer.writeUInt16LE(0, 6);
		buffer.writeUInt16LE(0, 8);
		buffer.writeUInt16LE(5, 10);
		buffer.writeUInt32LE(1000, 12);
		buffer.writeUInt32LE(5000, 16);
		buffer.writeUInt16LE(0, 20);

		const result = parseEndOfCentralDirectory(buffer);

		expect(result.entryCount).toBe(5);
		expect(result.centralDirectorySize).toBe(1000);
		expect(result.centralDirectoryOffset).toBe(5000);
		expect(result.comment).toBe("");
	});

	it("should parse EOCD with comment", () => {
		const commentText = "Test comment";
		const buffer = Buffer.alloc(22 + commentText.length);
		buffer.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
		buffer.writeUInt16LE(0, 4);
		buffer.writeUInt16LE(0, 6);
		buffer.writeUInt16LE(0, 8);
		buffer.writeUInt16LE(3, 10);
		buffer.writeUInt32LE(500, 12);
		buffer.writeUInt32LE(3000, 16);
		buffer.writeUInt16LE(commentText.length, 20);
		buffer.write(commentText, 22, "utf-8");

		const result = parseEndOfCentralDirectory(buffer);

		expect(result.entryCount).toBe(3);
		expect(result.centralDirectorySize).toBe(500);
		expect(result.centralDirectoryOffset).toBe(3000);
		expect(result.comment).toBe(commentText);
	});

	it("should throw on invalid signature", () => {
		const buffer = Buffer.alloc(22);
		buffer.writeUInt32LE(0x12345678, 0);

		expect(() => parseEndOfCentralDirectory(buffer)).toThrow(
			"Invalid End of Central Directory signature",
		);
	});
});

describe("parseCentralDirectory", () => {
	it("should parse single entry", () => {
		const filename = "test.txt";
		const buffer = Buffer.alloc(46 + filename.length);

		buffer.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
		buffer.writeUInt16LE(20, 4);
		buffer.writeUInt16LE(20, 6);
		buffer.writeUInt16LE(0, 8);
		buffer.writeUInt16LE(8, 10);
		buffer.writeUInt16LE(0, 12);
		buffer.writeUInt16LE(0, 14);
		buffer.writeUInt32LE(0x12345678, 16);
		buffer.writeUInt32LE(100, 20);
		buffer.writeUInt32LE(200, 24);
		buffer.writeUInt16LE(filename.length, 28);
		buffer.writeUInt16LE(0, 30);
		buffer.writeUInt16LE(0, 32);
		buffer.writeUInt16LE(0, 34);
		buffer.writeUInt16LE(0, 36);
		buffer.writeUInt32LE(0, 38);
		buffer.writeUInt32LE(1000, 42);
		buffer.write(filename, 46, "utf-8");

		const result = parseCentralDirectory(buffer, 1, "");

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].filename).toBe(filename);
		expect(result.entries[0].compressionMethod).toBe(8);
		expect(result.entries[0].compressedSize).toBe(100);
		expect(result.entries[0].uncompressedSize).toBe(200);
		expect(result.entries[0].localHeaderOffset).toBe(1000);
		expect(result.entries[0].isDirectory).toBe(false);
	});

	it("should identify directories", () => {
		const filename = "folder/";
		const buffer = Buffer.alloc(46 + filename.length);

		buffer.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
		buffer.writeUInt16LE(20, 4);
		buffer.writeUInt16LE(20, 6);
		buffer.writeUInt16LE(0, 8);
		buffer.writeUInt16LE(0, 10);
		buffer.writeUInt16LE(0, 12);
		buffer.writeUInt16LE(0, 14);
		buffer.writeUInt32LE(0, 16);
		buffer.writeUInt32LE(0, 20);
		buffer.writeUInt32LE(0, 24);
		buffer.writeUInt16LE(filename.length, 28);
		buffer.writeUInt16LE(0, 30);
		buffer.writeUInt16LE(0, 32);
		buffer.writeUInt16LE(0, 34);
		buffer.writeUInt16LE(0, 36);
		buffer.writeUInt32LE(0, 38);
		buffer.writeUInt32LE(0, 42);
		buffer.write(filename, 46, "utf-8");

		const result = parseCentralDirectory(buffer, 1, "");

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].filename).toBe(filename);
		expect(result.entries[0].isDirectory).toBe(true);
	});

	it("should throw on invalid signature", () => {
		const buffer = Buffer.alloc(46);
		buffer.writeUInt32LE(0x12345678, 0);

		expect(() => parseCentralDirectory(buffer, 1, "")).toThrow(
			"Invalid Central Directory signature",
		);
	});
});

describe("parseLocalFileHeader", () => {
	it("should parse local file header", () => {
		const buffer = Buffer.alloc(30);
		buffer.writeUInt16LE(10, 26);
		buffer.writeUInt16LE(20, 28);

		const result = parseLocalFileHeader(buffer);

		expect(result.filenameLength).toBe(10);
		expect(result.extraFieldLength).toBe(20);
		expect(result.dataOffset).toBe(60);
	});

	it("should calculate correct data offset", () => {
		const buffer = Buffer.alloc(30);
		buffer.writeUInt16LE(15, 26);
		buffer.writeUInt16LE(25, 28);

		const result = parseLocalFileHeader(buffer);

		expect(result.dataOffset).toBe(30 + 15 + 25);
	});

	it("should handle zero-length fields", () => {
		const buffer = Buffer.alloc(30);
		buffer.writeUInt16LE(0, 26);
		buffer.writeUInt16LE(0, 28);

		const result = parseLocalFileHeader(buffer);

		expect(result.filenameLength).toBe(0);
		expect(result.extraFieldLength).toBe(0);
		expect(result.dataOffset).toBe(30);
	});
});
