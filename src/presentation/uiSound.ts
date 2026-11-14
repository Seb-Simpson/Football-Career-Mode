/** Interface sounds, routed through the shared sound engine. */
import { sound } from './sound';

export const uiSound = {
  setEnabled(on: boolean) {
    sound.setPrefs(sound.musicOn, on);
  },
  click() {
    sound.click();
  },
  whoosh() {
    sound.whoosh();
  },
  stamp() {
    sound.stamp();
  },
  /** Big moments switch to the anthem. */
  fanfare() {
    sound.playMusic('musicFloodlights');
  },
  cheer() {
    sound.cheer();
  },
};
