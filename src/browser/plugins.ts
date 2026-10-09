import type { RendererPlugin } from '@renderer/plugin-host/api';
import { catalogPlugin } from '@plugins/catalog';
import { getPdbPlugin } from '@plugins/getpdb';
import { mdtoolsPlugin } from '@plugins/mdtools';
import { consolePlugin } from '@plugins/console';
import { sequencePlugin } from '@plugins/sequence';

export const BUILTIN_PLUGINS: readonly RendererPlugin[] = [
  getPdbPlugin, sequencePlugin, catalogPlugin, mdtoolsPlugin, consolePlugin,
];
