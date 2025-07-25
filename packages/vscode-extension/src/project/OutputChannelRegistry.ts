import { Disposable, LogOutputChannel, window } from "vscode";
import { Output } from "../common/OutputChannel";
import { Logger } from "../Logger";

export class OutputChannelRegistry implements Disposable {
  private channelByName = new Map<Output, LogOutputChannel>([
    [Output.Ide, Logger.rawOutputChannel],
  ]);

  getOrCreateOutputChannel(channel: Output) {
    const logOutput = this.channelByName.get(channel);
    if (logOutput) {
      return logOutput;
    }

    const newOutputChannel = window.createOutputChannel(channel, { log: true });
    this.channelByName.set(channel, newOutputChannel);
    return newOutputChannel;
  }

  dispose() {
    this.channelByName.entries().forEach(([k, c]) => {
      // NOTE: we special-case the IDE output channel to keep it open
      // even when the IDE is disposed.
      if (k !== Output.Ide) {
        c.dispose();
      }
    });
  }
}
