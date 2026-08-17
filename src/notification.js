import { execSync } from 'child_process';

export function sendNotification(title, message, subtitle = '') {
  try {
    const script = `display notification "${message}" with title "${title}"${subtitle ? ` subtitle "${subtitle}"` : ''}`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  } catch (error) {
    console.error('Notification error:', error.message);
  }
}
