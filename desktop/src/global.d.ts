export {};

declare global {
  interface Window {
    pointDesktop: {
      setClickThrough(enabled: boolean): void;
      hide(): void;
      quit(): void;
      captureScreen(): Promise<string | null>;
      onCommand(callback: (command: string) => void): () => void;
    };
  }
}
