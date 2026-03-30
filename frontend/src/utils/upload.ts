import { useLayoutStore } from "@/stores/layout";
import { useUploadStore } from "@/stores/upload";
import url from "@/utils/url";
import { files as api } from '@/api';

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  file?: object;
  children?: FileNode[];
}

function flatToTree(flatArray: UploadList): FileNode | null {
  const nodeMap: Record<string, FileNode> = {};


  // First pass: create all nodes
  flatArray.forEach((item) => {
    nodeMap[item.fullPath!] = {
      fullPath: item.fullPath!,
      isDir: item.isDir,
      name: item.name,
      size: item.size,
      ...(item.isDir && { children: [] }),
      ...(item.file && { file: item.file }),
    };
  });

  let root: FileNode | null = null;

  // Second pass: build hierarchy
  flatArray.forEach((item) => {
    // TODO C'est un problème si item.fullPath est undefined

    const node = nodeMap[item.fullPath!];
    const lastSlash = item.fullPath!.lastIndexOf("/");

    if (lastSlash === -1) {
      root = node;
    } else {
      const parentPath = item.fullPath!.substring(0, lastSlash);
      const parent = nodeMap[parentPath];
      if (parent?.children) {
        parent.children.push(node);
      }
    }
  });

  return root;
}

/**
 * Return conflict files from the tree structure instead the classic UploadList
 * @param files
 */
export function treeCheckConflict(files: UploadList): ConflictingResource[] {

}

export function checkConflict(
  files: UploadList | Array<any>,
  dest: ResourceItem[]
): ConflictingResource[] {
  if (typeof dest === "undefined" || dest === null) {
    dest = [];
  }
  const conflictingFiles: ConflictingResource[] = [];

  const folder_upload = files[0].fullPath !== undefined;

  function getFile(name: string): ResourceItem | null {
    for (const item of dest) {
      if (item.name == name) return item;
    }

    return null;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = file.name;

    if (folder_upload && file.isDir) {
      const dirs = file.fullPath?.split("/");
      // For folder uploads, destination listing is flat and only contains
      // top-level entries. Treating every nested file as a conflict when the
      // parent folder exists blocks the whole upload (see #5798), so skip
      // preflight conflict detection for nested files.
      if (dirs && dirs.length > 1) {
        continue;
      }
    }

    const item = getFile(name);
    if (item != null) {
      conflictingFiles.push({
        index: i,
        name: item.path,
        origin: {
          lastModified: file.modified || file.file?.lastModified,
          size: file.size,
        },
        dest: {
          lastModified: item.modified,
          size: item.size,
        },
        checked: ["origin"],
      });
    }

    // Add check on Size
  }

  return conflictingFiles;
}

export function scanFiles(dt: DataTransfer): Promise<UploadList | FileList> {
  return new Promise((resolve) => {
    let reading = 0;
    const contents: UploadList = [];

    if (dt.items) {
      // ts didn't like the for of loop even tho
      // it is the official example on MDN
      // for (const item of dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (
          item.kind === "file" &&
          typeof item.webkitGetAsEntry === "function"
        ) {
          const entry = item.webkitGetAsEntry();
          entry && readEntry(entry);
        }
      }
    } else {
      resolve(dt.files);
    }

    function readEntry(entry: FileSystemEntry, directory = ""): void {
      if (entry.isFile) {
        reading++;
        (entry as FileSystemFileEntry).file((file) => {
          reading--;

          contents.push({
            file,
            name: file.name,
            size: file.size,
            isDir: false,
            fullPath: `${directory}${file.name}`,
          });

          if (reading === 0) {
            resolve(contents);
          }
        });
      } else if (entry.isDirectory) {
        const dir = {
          isDir: true,
          size: 0,
          fullPath: `${directory}${entry.name}`,
          name: entry.name,
        };

        contents.push(dir);

        readReaderContent(
          (entry as FileSystemDirectoryEntry).createReader(),
          `${directory}${entry.name}`
        );
      }
    }

    function readReaderContent(
      reader: FileSystemDirectoryReader,
      directory: string
    ): void {
      reading++;

      reader.readEntries((entries) => {
        reading--;
        if (entries.length > 0) {
          const dirWithSlash = directory.endsWith("/")
            ? directory
            : `${directory}/`;
          for (const entry of entries) {
            readEntry(entry, dirWithSlash);
          }

          readReaderContent(reader, dirWithSlash);
        }

        if (reading === 0) {
          resolve(contents);
        }
      });
    }
  });
}

function detectType(mimetype: string): ResourceType {
  if (mimetype.startsWith("video")) return "video";
  if (mimetype.startsWith("audio")) return "audio";
  if (mimetype.startsWith("image")) return "image";
  if (mimetype.startsWith("pdf")) return "pdf";
  if (mimetype.startsWith("text")) return "text";
  return "blob";
}

export function handleFiles(
  files: UploadList,
  base: string,
  overwrite = false
) {
  const uploadStore = useUploadStore();
  const layoutStore = useLayoutStore();

  layoutStore.closeHovers();

  for (const file of files) {
    let path = base;

    if (file.fullPath !== undefined) {
      path += url.encodePath(file.fullPath);
    } else {
      path += url.encodeRFC5987ValueChars(file.name);
    }

    if (file.isDir) {
      path += "/";
    }

    const type = file.isDir ? "dir" : detectType((file.file as File).type);

    uploadStore.upload(
      path,
      file.name,
      file.file ?? null,
      file.overwrite || overwrite,
      type
    );
  }
}
