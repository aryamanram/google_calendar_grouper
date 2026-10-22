# Introduction

Calendar Grouper is a Chrome extension with a small cloud service behind it. It combines the Google Calendars you pick into **one shared calendar** that someone else can add and toggle on or off.

## The problem

Google Calendar lets you keep a separate calendar for each part of your life: Work, School, Family, Workout and so on. That keeps your own view tidy. But when you want a partner, family member or teammate to see your schedule, you have two choices:

- **Share every calendar separately.** They end up with five or ten calendars to manage, and have to add each new one you create.
- **Merge everything into one calendar.** Now your own view loses its organization.

## What Calendar Grouper does

You keep your calendars exactly as they are. Calendar Grouper creates one extra calendar in your account, called something like *My full schedule*, and keeps it filled with copies of the events from the calendars you choose.

- **Pick which calendars to include.** Leave out anything private.
- **Choose a detail level per calendar:** <span class="cal-dot full"></span>full details, or <span class="cal-dot busy"></span>busy only, which shows the time blocked out as "Busy" with no title or description.
- **Share the one calendar** with anyone, using Google Calendar's normal sharing. They need nothing installed.

Changes you make to your calendars appear on the shared calendar within about two minutes, even when your computer is off.

## Who it's for

- Couples and families who want a single view of each other's schedules
- People who organize their calendar by topic but want to share their availability simply
- Anyone who wants to share busy times from some calendars and full details from others

## Status

Calendar Grouper is **open source and self-hosted**. There's no public service to sign up for: you run your own copy of the backend in your own Google Cloud project, and invite whoever you like from the extension: a partner, family, friends. Each of them installs the extension, opens your invite link and signs in with Google, and their calendars stay separate from yours.

For a handful of people checked every two minutes, the backend stays within Google Cloud's free tier. See [What does it cost?](./faq#what-does-it-cost)

- To see what the extension looks like day to day, read [Using Calendar Grouper](./using).
- To set up your own copy, start with [Local setup](/self-hosting/setup).
