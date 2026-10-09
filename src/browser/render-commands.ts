import { useCommands, useRegisterCommand } from '@renderer/commands/CommandRegistry';
import { CmdId } from '@renderer/commands/ids';
import { showRecordingDialog } from './recording';

export function useRenderCommands(): void {
  const commands = useCommands();
  useRegisterCommand(CmdId.UiRenderWindow, () => commands.dispatch(CmdId.ExportPng));
  useRegisterCommand(CmdId.UiRenderWindowImage, () => commands.dispatch(CmdId.ExportPng));
  useRegisterCommand(CmdId.UiRenderWindowMovie, () => showRecordingDialog());
}
