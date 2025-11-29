import {
	CENTRAL_DIRECTORY_HEADER_SIZE,
	CENTRAL_DIRECTORY_SIGNATURE,
	END_OF_CENTRAL_DIRECTORY_SIGNATURE,
	END_OF_CENTRAL_DIRECTORY_SIZE,
} from "./constants.js";
import type { ZipCentralDirectory, ZipEntry } from "./types.js";

export function parseEndOfCentralDirectory(buffer: Buffer): {
	centralDirectoryOffset: number;
	centralDirectorySize: number;
	entryCount: number;
	comment: string;
} {
	const signature = buffer.readUInt32LE(0);
	if (signature !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
		throw new Error("Invalid End of Central Directory signature");
	}

	const entryCount = buffer.readUInt16LE(10);
	const centralDirectorySize = buffer.readUInt32LE(12);
	const centralDirectoryOffset = buffer.readUInt32LE(16);
	const commentLength = buffer.readUInt16LE(20);
	const comment = buffer.toString("utf-8", 22, 22 + commentLength);

	return {
		centralDirectoryOffset,
		centralDirectorySize,
		entryCount,
		comment,
	};
}

export function parseCentralDirectory(
	buffer: Buffer,
	entryCount: number,
	comment: string,
): ZipCentralDirectory {
	const entries: ZipEntry[] = [];
	let offset = 0;

	for (let i = 0; i < entryCount; i++) {
		const signature = buffer.readUInt32LE(offset);
		if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
			throw new Error(
				`Invalid Central Directory signature at offset ${offset}`,
			);
		}

		const compressionMethod = buffer.readUInt16LE(offset + 10);
		const lastModTime = buffer.readUInt16LE(offset + 12);
		const lastModDate = buffer.readUInt16LE(offset + 14);
		const crc32 = buffer.readUInt32LE(offset + 16);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const uncompressedSize = buffer.readUInt32LE(offset + 24);
		const filenameLength = buffer.readUInt16LE(offset + 28);
		const extraFieldLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localHeaderOffset = buffer.readUInt32LE(offset + 42);

		const filenameStart = offset + CENTRAL_DIRECTORY_HEADER_SIZE;
		const filename = buffer.toString(
			"utf-8",
			filenameStart,
			filenameStart + filenameLength,
		);

		const isDirectory = filename.endsWith("/");
		const lastModified = dosDateTimeToDate(lastModDate, lastModTime);

		entries.push({
			filename,
			compressedSize,
			uncompressedSize,
			compressionMethod,
			crc32,
			lastModified,
			localHeaderOffset,
			isDirectory,
		});

		offset +=
			CENTRAL_DIRECTORY_HEADER_SIZE +
			filenameLength +
			extraFieldLength +
			commentLength;
	}

	return { entries, comment };
}

function dosDateTimeToDate(dosDate: number, dosTime: number): Date {
	const day = dosDate & 0x1f;
	const month = ((dosDate >> 5) & 0x0f) - 1;
	const year = ((dosDate >> 9) & 0x7f) + 1980;

	const second = (dosTime & 0x1f) * 2;
	const minute = (dosTime >> 5) & 0x3f;
	const hour = (dosTime >> 11) & 0x1f;

	return new Date(year, month, day, hour, minute, second);
}

export function parseLocalFileHeader(buffer: Buffer): {
	filenameLength: number;
	extraFieldLength: number;
	dataOffset: number;
} {
	const filenameLength = buffer.readUInt16LE(26);
	const extraFieldLength = buffer.readUInt16LE(28);
	const dataOffset = 30 + filenameLength + extraFieldLength;

	return {
		filenameLength,
		extraFieldLength,
		dataOffset,
	};
}
