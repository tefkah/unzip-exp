export interface ZipEntry {
	filename: string;
	compressedSize: number;
	uncompressedSize: number;
	compressionMethod: number;
	crc32: number;
	lastModified: Date;
	localHeaderOffset: number;
	isDirectory: boolean;
}

export interface ZipCentralDirectory {
	entries: ZipEntry[];
	comment: string;
}
