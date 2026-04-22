export interface ProgressReporter {
  preparingChunk(index: number, total: number, inputCount: number): void;
  uploadingInput(): void;
  uploadedFile(fileId: string): void;
  creatingJob(): void;
  createdJob(jobId: string): void;
  waitingForJob(): void;
  jobStatus(status: string): void;
  downloadingOutput(fileId: string): void;
  savedChunkOutput(path: string): void;
  mergingChunkOutputs(): void;
  savedOutput(path: string): void;
}

function writeLine(write: (chunk: string) => void, line: string): void {
  write(`${line}\n`);
}

export function createStderrProgressReporter(write: (chunk: string) => void): ProgressReporter {
  let lastStatus: string | undefined;

  return {
    preparingChunk(index, total, inputCount) {
      writeLine(write, `Preparing chunk ${index}/${total} (${inputCount} files)...`);
    },
    uploadingInput() {
      writeLine(write, 'Uploading input...');
    },
    uploadedFile(fileId) {
      writeLine(write, `Uploaded file: ${fileId}`);
    },
    creatingJob() {
      writeLine(write, 'Creating job...');
    },
    createdJob(jobId) {
      writeLine(write, `Created job: ${jobId}`);
    },
    waitingForJob() {
      lastStatus = undefined;
      writeLine(write, 'Waiting for job...');
    },
    jobStatus(status) {
      if (status === lastStatus) {
        return;
      }

      lastStatus = status;
      writeLine(write, `Status: ${status}`);
    },
    downloadingOutput(fileId) {
      writeLine(write, `Downloading output: ${fileId}`);
    },
    savedChunkOutput(path) {
      writeLine(write, `Saved chunk output: ${path}`);
    },
    mergingChunkOutputs() {
      writeLine(write, 'Merging chunk outputs...');
    },
    savedOutput(path) {
      writeLine(write, `Saved output: ${path}`);
    },
  };
}

export const silentProgressReporter: ProgressReporter = {
  preparingChunk() {},
  uploadingInput() {},
  uploadedFile() {},
  creatingJob() {},
  createdJob() {},
  waitingForJob() {},
  jobStatus() {},
  downloadingOutput() {},
  savedChunkOutput() {},
  mergingChunkOutputs() {},
  savedOutput() {},
};
