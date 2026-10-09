import { Buffer } from 'buffer';
import { wasm } from '../browser/core';
const fs = () => {
  if (!wasm) throw new Error('The virtual filesystem is not ready.');
  return wasm.FS;
};
export const existsSync = (path: string) => { try { fs().stat(path); return true; } catch { return false; } };
export function mkdirSync(path: string, opts?: any) { opts?.recursive ? fs().mkdirTree(path) : fs().mkdir(path); }
export function readFileSync(path: string, opts?: any): any {
  const data = Buffer.from(fs().readFile(path));
  const encoding = typeof opts === 'string' ? opts : opts?.encoding;
  return encoding ? data.toString(encoding) : data;
}
export function writeFileSync(path: string, data: any, opts?: any) {
  fs().writeFile(path, typeof data === 'string' ? data : new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength));
}
export const appendFileSync = (path: string, data: any) => fs().writeFile(path, data, { flags: 'a' });
export function statSync(path: string) { const s = fs().stat(path); return { ...s, isFile: () => fs().isFile(s.mode), isDirectory: () => fs().isDir(s.mode) }; }
export const lstatSync = statSync;
export const readdirSync = (path: string) => fs().readdir(path).filter((v: string) => v !== '.' && v !== '..');
export function rmSync(path: string, opts?: any) {
  if (!existsSync(path)) { if (opts?.force) return; throw new Error('File does not exist: ' + path); }
  if (statSync(path).isDirectory()) {
    if (opts?.recursive) for (const child of readdirSync(path)) rmSync(path + '/' + child, opts);
    fs().rmdir(path);
  } else fs().unlink(path);
}
export const unlinkSync = (path: string) => fs().unlink(path);
export const rmdirSync = (path: string) => fs().rmdir(path);
export const renameSync = (a: string, b: string) => fs().rename(a, b);
export const copyFileSync = (a: string, b: string) => fs().writeFile(b, fs().readFile(a));
export function mkdtempSync(prefix: string) { const path = prefix + crypto.randomUUID(); fs().mkdirTree(path); return path; }
export const accessSync = (path: string) => { fs().stat(path); };
export const openSync = (path: string, flags: string) => fs().open(path, flags).fd;
export const closeSync = (fd: number) => fs().close(fs().getStream(fd));
export const readSync = (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => fs().read(fs().getStream(fd), buffer, offset, length, position);
export const writeSync = (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => fs().write(fs().getStream(fd), buffer, offset, length, position);
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2 };
export const promises = { readFile: async (...a: Parameters<typeof readFileSync>) => readFileSync(...a), writeFile: async (...a: Parameters<typeof writeFileSync>) => writeFileSync(...a), stat: async (p: string) => statSync(p), mkdir: async (...a: Parameters<typeof mkdirSync>) => mkdirSync(...a), rm: async (...a: Parameters<typeof rmSync>) => rmSync(...a) };
export default { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, lstatSync, readdirSync, rmSync, unlinkSync, rmdirSync, renameSync, copyFileSync, mkdtempSync, accessSync, openSync, closeSync, readSync, writeSync, constants, promises };
