# Firebot Tiltify Integration

This is the source code for the Tiltify integration for Firebot.

At this point in time, the integration works using access tokens, due to OAuth2 not working properly.
This integration also isn't fully developed yet and there are some features missing, like entries in the activity feed or a campaign dropdown selector.

At this point in time, there is a donation event and a reward filter, which allows for running effects when a donation happens, either with or without reward.

## How to install

Download the current version of the script from the releases and put it in your `scripts` folder. In Firebot, open your settings, navigate to `Scripts` and press `Manage Startup Scripts`, then `Add New Script` and lastly select the Tiltify script. After that, restart Firebot.

After the restart, if you go into your settings again, on the `Integrations` page, there should now be the Tiltify integration. Press the `Link` button and follow the steps. After you're done, you will need to grab either your campaign ID or your campaign slug, although only the campaign ID has been tested. Once you have it, click `Configure` and put your campaign ID in the field.

That's everything needed for the setup. In order for events to come through, you will then need to turn on the connection in your connection panel.+

## Building from source

If you want to build the script from source, make sure you have NodeJS 16 and NPM installed and available in your PATH, then follow the following steps:

1. `git clone https://github.com/cozyGalvinism/FirebotTiltify`
2. `cd FirebotTiltify`
3. `npm i`
4. `npm run build:dev`

The script is automatically installed into your `scripts` folder.

## Planned features

I plan to add a variable for the donation info, as well as campaign-related events, like if the current campaign goal has been reached. I also want to add a dropdown for being able to select the campaign easier. Pull requests are always welcome!

## Contributing

This project has only been tested with Node 16, so if you want to build the script from the source code, please use that Node version when reporting bugs during builds. Other than that, I would be happy for contributors, as JavaScript is not my strongest programming language.
