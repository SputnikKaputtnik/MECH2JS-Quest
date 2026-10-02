/** Visible native-runtime tests must not hot-reload a page inside active XR. */
import { mergeConfig } from 'vite';
import base from '../vite.config.ts';
export default mergeConfig(base, { server: { hmr: false, watch: null } });
