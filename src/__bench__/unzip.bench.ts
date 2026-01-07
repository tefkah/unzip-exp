import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import util from "node:util";
import AdmZip from "adm-zip";
import extractZip from "extract-zip";
import { afterAll, beforeAll, bench, describe } from "vitest";
import yauzl from "yauzl";
import { extract } from "../index.js";

const EPUB_PATH = new URL("./Moby.epub", import.meta.url).pathname;
const MANY_TINY_FILES_PATH = new URL("./many_tiny_files.zip", import.meta.url)
	.pathname;

const OUTPUT_BASE = new URL("./output", import.meta.url).pathname;

function promisify<Arg, Options, Return>(
	api: (
		arg: Arg,
		options: Options,
		callback: (err: Error | null, result: Return) => void,
	) => void,
): (arg: Arg, options: Options) => Promise<Return> {
	return (arg: Arg, options: Options) =>
		new Promise((resolve, reject) => {
			api(arg, options, (err, response) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(response);
			});
		});
}

async function cleanupOutput(testName: string) {
	const outputDir = join(OUTPUT_BASE, testName);
	await rm(outputDir, { recursive: true, force: true });
}

async function setupOutput(testName: string) {
	const outputDir = join(OUTPUT_BASE, testName);
	await mkdir(outputDir, { recursive: true });
	return outputDir;
}

const testCases = [
	"yauzl (streaming)",
	"our-impl (streaming)",
	"adm-zip (buffer)",
	"extract-zip (buffer)",
] as const;

type TestCase = (typeof testCases)[number];
const getOutputDir = (testCase: TestCase) => join(OUTPUT_BASE, testCase);

// bench(
// 	"unzipper (streaming)",
// 	async () => {
// 		try {
// 			const outputDir = await setupOutput("unzipper");
// 			await pipeline(
// 				createReadStream(EPUB_PATH),
// 				unzipper.Extract({ path: outputDir }),
// 			);
// 			await cleanupOutput("unzipper");
// 		} catch (error) {
// 			console.error(error);
// 		}
// 		console.log("unzipper done");
// 	},
// 	{ iterations: 1, warmupIterations: 0 },
// );

async function unzipYauzl(inputPath: string, outputDir: string) {
	const zipfile = await promisify<
		string,
		{ lazyEntries: boolean },
		yauzl.ZipFile
	>(yauzl.open.bind(yauzl))(inputPath, { lazyEntries: true });

	const { promise, resolve } = Promise.withResolvers<void>();

	zipfile.on("end", () => {
		resolve();
	});
	const openReadStream = util.promisify(zipfile.openReadStream.bind(zipfile));
	zipfile.readEntry();
	zipfile.on("entry", async (entry) => {
		if (entry.fileName.endsWith("/")) {
			// Directory file names end with '/'.
			// Note that entries for directories themselves are optional.
			// An entry's fileName implicitly requires its parent directories to exist.
			zipfile.readEntry();
		} else {
			const writePath = join(outputDir, entry.fileName);
			const readStream = await openReadStream(entry);
			await mkdir(dirname(writePath), { recursive: true });
			// file entry
			await new Promise<void>((resolvePipe) => {
				const writePath = join(outputDir, entry.fileName);
				const writeStream = createWriteStream(writePath);
				writeStream.on("finish", () => {
					resolvePipe();
				});
				readStream.pipe(writeStream);
			}).finally(() => {
				zipfile.readEntry();
			});
		}
	});
	await promise;
}

async function unzipOurImpl(inputPath: string, outputDir: string) {
	await extract(inputPath, outputDir);
}

async function unzipAdmZip(inputPath: string, outputDir: string) {
	const zip = new AdmZip(inputPath);
	zip.extractAllTo(outputDir, true);
}

async function unzipExtractZip(inputPath: string, outputDir: string) {
	await extractZip(inputPath, { dir: outputDir });
}

describe("unzip many tiny files", () => {
	beforeAll(async () => {
		for (const testCase of testCases) {
			await cleanupOutput(testCase);
			await setupOutput(testCase);
		}
	});

	afterAll(async () => {
		// todo: validate whether outputs are the same
		for (const testCase of testCases) {
			await cleanupOutput(testCase);
		}
	});

	bench(
		"tiny files: yauzl (streaming)",
		async () => {
			await unzipYauzl(MANY_TINY_FILES_PATH, getOutputDir("yauzl (streaming)"));
		},
		{ iterations: 3, warmupIterations: 0 },
	);

	bench(
		"tiny files: our implementation (streaming)",
		async () => {
			await unzipOurImpl(
				MANY_TINY_FILES_PATH,
				getOutputDir("our-impl (streaming)"),
			);
		},
		{ iterations: 3, warmupIterations: 0 },
	);

	bench(
		"tiny files: adm-zip (buffer)",
		async () => {
			await unzipAdmZip(MANY_TINY_FILES_PATH, getOutputDir("adm-zip (buffer)"));
		},
		{ iterations: 3, warmupIterations: 0 },
	);

	bench(
		"tiny files: extract-zip (buffer)",
		async () => {
			await unzipExtractZip(
				MANY_TINY_FILES_PATH,
				getOutputDir("extract-zip (buffer)"),
			);
		},
		{ iterations: 3, warmupIterations: 0 },
	);
});

describe("unzip large", () => {
	beforeAll(async () => {
		for (const testCase of testCases) {
			await cleanupOutput(testCase);
			await setupOutput(testCase);
		}
	});

	afterAll(async () => {
		for (const testCase of testCases) {
			await cleanupOutput(testCase);
		}
	});

	bench(
		"large: yauzl (streaming)",
		async () => {
			await unzipYauzl(EPUB_PATH, getOutputDir("yauzl (streaming)"));
			// await cleanupOutput("yauzl");
		},
		{ iterations: 3, warmupIterations: 0 },
	);

	bench(
		"large: our implementation (streaming)",
		async () => {
			await unzipOurImpl(EPUB_PATH, getOutputDir("our-impl (streaming)"));
		},
		{ iterations: 3, warmupIterations: 0 },
	);

	bench(
		"large: adm-zip (buffer)",
		async () => {
			await unzipAdmZip(EPUB_PATH, getOutputDir("adm-zip (buffer)"));
		},
		{ iterations: 3, warmupIterations: 0 },
	);

	bench(
		"large: extract-zip (buffer)",
		async () => {
			await unzipExtractZip(EPUB_PATH, getOutputDir("extract-zip (buffer)"));
		},
		{ iterations: 3, warmupIterations: 0 },
	);
});
