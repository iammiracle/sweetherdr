// sweetsimscreen: holds the simulator frames sweetsim shows. Herdr redraws a
// picture when its file under mods/ changes, and reloads the mod whose folder
// it is in, so the frames get a folder (and an empty mod) of their own.
import { View, div } from "gpui-kit";

export default class Screen extends View {
  render() { return div(); }
}
