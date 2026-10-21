(() => {
  const video = document.querySelector('.campus-background-video');
  const button = document.querySelector('.background-motion-toggle');
  if (!video || !button) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userChoice = null;
  const updateButton = () => {
    const paused = video.paused;
    button.dataset.paused = String(paused);
    const label = paused ? 'Putar video latar' : 'Jeda video latar';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  const syncPlayback = () => {
    const shouldPlay = !document.hidden && (userChoice === true || (userChoice === null && !preference.matches));
    if (!shouldPlay) {
      video.pause();
      updateButton();
      return;
    }
    const playback = video.play();
    if (playback && typeof playback.catch === 'function') playback.catch(updateButton);
  };
  button.addEventListener('click', () => {
    userChoice = video.paused;
    syncPlayback();
  });
  video.addEventListener('canplay', () => {
    button.hidden = false;
    syncPlayback();
  });
  video.addEventListener('playing', updateButton);
  video.addEventListener('pause', updateButton);
  video.addEventListener('error', () => { button.hidden = true; });
  preference.addEventListener('change', () => { userChoice = null; syncPlayback(); });
  document.addEventListener('visibilitychange', syncPlayback);
  if (video.readyState >= 3) button.hidden = false;
  syncPlayback();
  updateButton();
})();
