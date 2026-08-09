import type { Preview } from '@storybook/react-vite'
import '../app/styles/index.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => {
      // Load Google Fonts
      if (typeof document !== 'undefined' && !document.getElementById('storybook-fonts')) {
        const link = document.createElement('link');
        link.id = 'storybook-fonts';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap';
        document.head.appendChild(link);
      }
      return <Story />;
    },
  ],
};

export default preview;