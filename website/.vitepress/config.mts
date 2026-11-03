import { defineConfig } from 'vitepress';

const repo = 'https://github.com/praneth2580/WRAITH';

export default defineConfig({
  title: 'wraith',
  description: 'Web scraping and browser automation for Node.js, with human-like input and optional AI, all in your own process.',
  lang: 'en',
  // Served from https://praneth2580.github.io/WRAITH/
  base: '/WRAITH/',
  cleanUrls: true,
  // The maintainers' README isn't a page of the site.
  srcExclude: ['README.md'],
  lastUpdated: false,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/WRAITH/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#6d5dfc' }],
    ['meta', { property: 'og:title', content: 'wraith: human-like web scraping and automation for Node.js' }],
    ['meta', { property: 'og:description', content: 'Human-like input, typed extraction, polite networking and optional AI, in your own process.' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/create-wraith', activeMatch: '/reference/' },
      {
        text: '0.1.0-beta.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'npm', link: 'https://www.npmjs.com/package/wraithjs' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Browser pages and static pages', link: '/guide/pages' },
          ],
        },
        {
          text: 'Essentials',
          items: [
            { text: 'Extracting data', link: '/guide/extracting' },
            { text: 'Finding elements', link: '/guide/targets' },
            { text: 'Human behaviour', link: '/guide/human-behaviour' },
            { text: 'Waiting', link: '/guide/waiting' },
          ],
        },
        {
          text: 'Real-world sites',
          items: [
            { text: 'Generated class names', link: '/guide/generated-class-names' },
            { text: 'Pagination', link: '/guide/pagination' },
            { text: 'Crawling', link: '/guide/crawling' },
            { text: 'Consent banners', link: '/guide/consent' },
            { text: 'CAPTCHAs and codes', link: '/guide/captchas' },
          ],
        },
        {
          text: 'AI',
          items: [{ text: 'AI extraction and actions', link: '/guide/ai' }],
        },
        {
          text: 'Configuration',
          items: [
            { text: 'Network and politeness', link: '/guide/network' },
            { text: 'Browser options and sessions', link: '/guide/browser-options' },
          ],
        },
        {
          text: 'Help',
          items: [
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'Devtools', link: '/guide/devtools' },
            { text: 'Use responsibly', link: '/guide/responsible-use' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API reference',
          items: [
            { text: 'createWraith options', link: '/reference/create-wraith' },
            { text: 'Wraith', link: '/reference/wraith' },
            { text: 'WraithPage', link: '/reference/wraith-page' },
            { text: 'StaticPage', link: '/reference/static-page' },
            { text: 'Targets', link: '/reference/targets' },
            { text: 'Selector schemas', link: '/reference/selector-schemas' },
            { text: 'JsonCapture', link: '/reference/json-capture' },
            { text: 'AI options', link: '/reference/ai-options' },
            { text: 'Result types', link: '/reference/types' },
            { text: 'Errors', link: '/reference/errors' },
            { text: 'Other exports', link: '/reference/other-exports' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: repo },
      { icon: 'npm', link: 'https://www.npmjs.com/package/wraithjs' },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: {
      message: 'Released under the MIT License. Beta: the API may change before 1.0.',
      copyright: '© 2026 Praneth Pujari',
    },
  },
});
