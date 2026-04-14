export async function runWithConcurrency<TInput, TResult>(args: {
  items: TInput[];
  concurrency: number;
  worker: (item: TInput, index: number) => Promise<TResult>;
}): Promise<TResult[]> {
  const concurrency = Math.max(1, Math.floor(args.concurrency));

  if (args.items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(args.items.length);
  let nextIndex = 0;
  let activeCount = 0;
  let settledCount = 0;
  let rejectOnce: ((error: unknown) => void) | null = null;
  let aborted = false;

  return new Promise<TResult[]>((resolve, reject) => {
    rejectOnce = (error: unknown) => {
      if (!aborted) {
        aborted = true;
        reject(error);
      }
    };

    const launchNext = () => {
      if (aborted) {
        return;
      }

      while (activeCount < concurrency && nextIndex < args.items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        activeCount += 1;

        void Promise.resolve()
          .then(() => args.worker(args.items[currentIndex], currentIndex))
          .then((result) => {
            if (aborted) {
              return;
            }

            results[currentIndex] = result;
            activeCount -= 1;
            settledCount += 1;

            if (settledCount === args.items.length) {
              resolve(results);
              return;
            }

            launchNext();
          })
          .catch((error) => {
            activeCount -= 1;
            rejectOnce?.(error);
          });
      }
    };

    launchNext();
  });
}
