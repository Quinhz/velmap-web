export {};

declare global {
  function qrcode(typeNumber: number, errorCorrectionLevel: string): {
    addData(data: string): void;
    make(): void;
    createSvgTag(cellSizeOrOptions?: number | { cellSize?: number; margin?: number }, margin?: number): string;
    createImgTag(cellSize?: number, margin?: number): string;
  };

  class BarcodeDetector {
    constructor(options?: { formats?: string[] });
    detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
    static getSupportedFormats(): Promise<string[]>;
  }

  interface Window {
    webkitAudioContext?: typeof AudioContext;
    showOpenFilePicker?: (options?: any) => Promise<any[]>;
    showSaveFilePicker?: (options?: any) => Promise<any>;
    activeTool?: string;
    [key: string]: any;
  }
}
