import { Window } from 'happy-dom';

const window = new Window({
  settings: {
    timer: {
      maxTimeout: 200,
      maxIntervalTime: 10,
      maxIntervalIterations: 1,
      preventTimerLoops: true
    }
  }
});

// Waits for async tasks to complete
await window.happyDOM.waitUntilComplete();
