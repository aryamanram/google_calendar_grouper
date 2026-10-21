import { defineConfig } from "vitepress";

// Set SITE_URL when building for the real domain, e.g.
//   SITE_URL=https://calendargrouper.com npm run build
// It's used for the sitemap and the link-preview image (LinkedIn, Slack...).
const SITE_URL = (process.env.SITE_URL || "https://calendar-grouper-511703.web.app").replace(/\/+$/, "");
const REPO = "https://github.com/aryamanram/google_calendar_grouper";
const DESCRIPTION =
  "Share all your Google Calendars as one calendar someone can toggle on and off, without merging them.";

export default defineConfig({
  title: "Calendar Grouper",
  description: DESCRIPTION,
  lang: "en-US",
  cleanUrls: true,
  srcExclude: ["README.md"],
  lastUpdated: true,

  sitemap: { hostname: SITE_URL },

  // The self-hosting guide links to the local backend.
  ignoreDeadLinks: "localhostLinks",

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    ["meta", { name: "theme-color", content: "#1a73e8" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Calendar Grouper" }],
    ["meta", { property: "og:title", content: "Calendar Grouper" }],
    ["meta", { property: "og:description", content: DESCRIPTION }],
    ["meta", { property: "og:image", content: `${SITE_URL}/og.png` }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],

  themeConfig: {
    logo: { src: "/logo.png", alt: "" },

    nav: [
      { text: "Guide", link: "/guide/introduction", activeMatch: "/guide/" },
      { text: "Self-hosting", link: "/self-hosting/setup", activeMatch: "/self-hosting/" },
      { text: "Changelog", link: "/changelog" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Using Calendar Grouper", link: "/guide/using" },
            { text: "How it works", link: "/guide/how-it-works" },
            { text: "FAQ", link: "/guide/faq" },
          ],
        },
      ],
      "/self-hosting/": [
        {
          text: "Self-hosting",
          items: [
            { text: "Local setup", link: "/self-hosting/setup" },
            { text: "Deploy to Google Cloud", link: "/self-hosting/deploy" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: REPO }],

    editLink: {
      pattern: `${REPO}/edit/main/site/:path`,
      text: "Suggest a change to this page",
    },

    search: { provider: "local" },

    footer: {
      message: '<a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:aryamanramchandran@gmail.com">Contact</a>',
      copyright: "Calendar Grouper is an independent project and isn't affiliated with Google.",
    },
  },
});
