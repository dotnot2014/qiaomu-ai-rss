declare module 'electron' {
  export const remote: {
    app: { getPath(name: 'temp'): string };
    dialog: {
      showSaveDialog(parent: unknown, options: { title: string; defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePath?: string }>;
    };
    getCurrentWindow(): unknown;
    BrowserWindow: new (options: { show: boolean; width: number; height: number; webPreferences: { sandbox: boolean } }) => {
      loadFile(path: string): Promise<void>;
      webContents: {
        executeJavaScript(code: string): Promise<unknown>;
        printToPDF(options: { pageSize: string; printBackground: boolean }): Promise<Uint8Array>;
      };
      destroy(): void;
    };
  };
}
