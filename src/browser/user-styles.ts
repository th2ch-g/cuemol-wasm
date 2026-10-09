import { existsSync } from '../shims/fs';

export function loadUserStyle(cm: any, userStylePath?: string): boolean {
  const manager = cm.getService('StyleManager');
  if (!manager) return false;
  if (userStylePath && existsSync(userStylePath)) {
    try { manager.loadStyleSetFromFile(0, userStylePath, false); }
    catch (error) { console.warn('User styles could not be loaded:', error); }
  }
  let uid = manager.hasStyleSet('user', 0);
  if (uid <= 0) uid = manager.createStyleSet('user', 0);
  const styles = manager.getStyleSet(uid);
  if (!styles || !manager.destroyStyleSet(0, uid)) return false;
  const registered = manager.registerStyleSet(styles, 0, 0);
  manager.firePendingEvents();
  return registered;
}
