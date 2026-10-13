export function folderName(path: string): string {
  if (path === "") return "Root folder";
  return path.slice(path.lastIndexOf("/") + 1);
}
