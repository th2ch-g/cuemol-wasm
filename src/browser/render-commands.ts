import { useRegisterCommand } from '@renderer/commands/CommandRegistry';
import { CmdId } from '@renderer/commands/ids';
import { IPC } from '@shared/ipcChannels';
import { showRecordingDialog } from './recording';

export function useRenderCommands(): void {
  useRegisterCommand(CmdId.UiRenderWindow, () => window.electronAPI?.invoke(IPC.RENDER_WINDOW_OPEN, { mode: 'still' }));
  useRegisterCommand(CmdId.UiRenderWindowImage, () => window.electronAPI?.invoke(IPC.RENDER_WINDOW_OPEN, { mode: 'still' }));
  useRegisterCommand(CmdId.UiRenderWindowMovie, () => showRecordingDialog());
}
