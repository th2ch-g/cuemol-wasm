export const tmpdir = () => '/tmp';
export const homedir = () => '/work';
export const platform = () => 'browser';
export const cpus = () => Array.from({ length: navigator.hardwareConcurrency || 2 }, () => ({ model: 'WebAssembly' }));
export default { tmpdir, homedir, platform, cpus };
