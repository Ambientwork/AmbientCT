import { startBoundedPoll } from '../src/utils/boundedPoll';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('startBoundedPoll', () => {
  test('calls onReady immediately when isReady is already true (no timer scheduled)', () => {
    const onReady = jest.fn();
    const onTimeout = jest.fn();
    startBoundedPoll(
      { intervalMs: 800, timeoutMs: 20000 },
      { isReady: () => true, onReady, onTimeout }
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('retries on the given interval until isReady flips true, then stops', () => {
    let readyAfter = 3; // becomes ready on the 3rd check
    let checks = 0;
    const onReady = jest.fn();
    const onTimeout = jest.fn();

    startBoundedPoll(
      { intervalMs: 800, timeoutMs: 20000 },
      {
        isReady: () => {
          checks += 1;
          return checks >= readyAfter;
        },
        onReady,
        onTimeout,
      }
    );

    expect(onReady).not.toHaveBeenCalled();
    jest.advanceTimersByTime(800); // 2nd check
    expect(onReady).not.toHaveBeenCalled();
    jest.advanceTimersByTime(800); // 3rd check -> ready
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    // no further polling after onReady fires
    jest.advanceTimersByTime(10000);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test('gives up and calls onTimeout once the time budget elapses, never onReady', () => {
    const onReady = jest.fn();
    const onTimeout = jest.fn();

    startBoundedPoll(
      { intervalMs: 1000, timeoutMs: 5000 },
      { isReady: () => false, onReady, onTimeout }
    );

    jest.advanceTimersByTime(4999);
    expect(onTimeout).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    // no further ticks after timeout
    jest.advanceTimersByTime(10000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('cancel() stops polling — neither onReady nor onTimeout fire afterwards', () => {
    const onReady = jest.fn();
    const onTimeout = jest.fn();

    const handle = startBoundedPoll(
      { intervalMs: 500, timeoutMs: 5000 },
      { isReady: () => false, onReady, onTimeout }
    );

    jest.advanceTimersByTime(1000);
    handle.cancel();
    jest.advanceTimersByTime(10000);

    expect(onReady).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('a throwing isReady is treated as not-ready rather than crashing the poll', () => {
    const onReady = jest.fn();
    const onTimeout = jest.fn();

    startBoundedPoll(
      { intervalMs: 100, timeoutMs: 300 },
      {
        isReady: () => {
          throw new Error('not ready yet');
        },
        onReady,
        onTimeout,
      }
    );

    jest.advanceTimersByTime(300);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
