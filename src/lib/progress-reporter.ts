export interface ProgressReporter {
  uploadingInput(): void;
  uploadedFile(fileId: string): void;
  creatingJob(): void;
  createdJob(jobId: string): void;
  waitingForJob(): void;
  jobStatus(status: string): void;
  downloadingOutput(fileId: string): void;
  savedOutput(path: string): void;
}

function writeLine(write: (chunk: string) => void, line: string): void {
  write(`${line}\n`);
}

export function createStderrProgressReporter(write: (chunk: string) => void): ProgressReporter {
  let lastStatus: string | undefined;

  return {
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
    savedOutput(path) {
      writeLine(write, `Saved output: ${path}`);
    },
  };
}

export const silentProgressReporter: ProgressReporter = {
  uploadingInput() {},
  uploadedFile() {},
  creatingJob() {},
  createdJob() {},
  waitingForJob() {},
  jobStatus() {},
  downloadingOutput() {},
  savedOutput() {},
};
