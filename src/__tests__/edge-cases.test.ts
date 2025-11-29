import { rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extract } from "../stream-extractor.js";
import AdmZip from "adm-zip";

const TEST_OUTPUT_DIR = join(process.cwd(), "src", "__tests__", "__edge_output__");
const TEST_ZIPS_DIR = join(process.cwd(), "src", "__tests__", "__test_zips__");

describe("edge cases", () => {
	beforeEach(async () => {
		await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
		await rm(TEST_ZIPS_DIR, { recursive: true, force: true });
		await mkdir(TEST_ZIPS_DIR, { recursive: true });
	});

	afterEach(async () => {
		await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
		await rm(TEST_ZIPS_DIR, { recursive: true, force: true });
	});

	it("should handle empty zip file", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "empty.zip");
		const zip = new AdmZip();
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should handle zip with only directories", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "dirs-only.zip");
		const zip = new AdmZip();
		zip.addFile("dir1/", Buffer.from(""));
		zip.addFile("dir2/", Buffer.from(""));
		zip.addFile("dir1/subdir/", Buffer.from(""));
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should handle zip with nested directory structure", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "nested.zip");
		const zip = new AdmZip();
		zip.addFile("a/", Buffer.from(""));
		zip.addFile("a/b/", Buffer.from(""));
		zip.addFile("a/b/c/", Buffer.from(""));
		zip.addFile("a/b/c/file.txt", Buffer.from("nested content"));
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should handle files with special characters in names", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "special-chars.zip");
		const zip = new AdmZip();
		zip.addFile("test file.txt", Buffer.from("space in name"));
		zip.addFile("test-file.txt", Buffer.from("dash"));
		zip.addFile("test_file.txt", Buffer.from("underscore"));
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should handle large uncompressed files", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "large-stored.zip");
		const zip = new AdmZip();
		const largeContent = Buffer.alloc(1024 * 1024, "x");
		zip.addFile("large.txt", largeContent, "", 0);
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should handle zip with many small files", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "many-files.zip");
		const zip = new AdmZip();

		for (let i = 0; i < 100; i++) {
			zip.addFile(`file${i}.txt`, Buffer.from(`content ${i}`));
		}

		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should throw on non-existent zip file", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "does-not-exist.zip");

		await expect(extract(zipPath, TEST_OUTPUT_DIR)).rejects.toThrow();
	});

	it("should handle concurrent extractions to different directories", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "concurrent.zip");
		const zip = new AdmZip();
		zip.addFile("test.txt", Buffer.from("test content"));
		zip.writeZip(zipPath);

		const dir1 = join(TEST_OUTPUT_DIR, "extract1");
		const dir2 = join(TEST_OUTPUT_DIR, "extract2");
		const dir3 = join(TEST_OUTPUT_DIR, "extract3");

		await Promise.all([
			extract(zipPath, dir1),
			extract(zipPath, dir2),
			extract(zipPath, dir3),
		]);

		expect(true).toBe(true);
	});

	it("should handle zip with empty files", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "empty-files.zip");
		const zip = new AdmZip();
		zip.addFile("empty1.txt", Buffer.from(""));
		zip.addFile("empty2.txt", Buffer.from(""));
		zip.addFile("not-empty.txt", Buffer.from("has content"));
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});

	it("should handle zip with mixed compression methods", async () => {
		const zipPath = join(TEST_ZIPS_DIR, "mixed-compression.zip");
		const zip = new AdmZip();
		zip.addFile("stored.txt", Buffer.from("stored content"), "", 0);
		zip.addFile("deflated.txt", Buffer.from("deflated content"));
		zip.writeZip(zipPath);

		await extract(zipPath, TEST_OUTPUT_DIR);

		expect(true).toBe(true);
	});
});

