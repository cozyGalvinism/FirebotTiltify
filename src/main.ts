import { Firebot } from "@crowbartools/firebot-custom-scripts-types";
import { register } from "./tiltify";

interface Params {};

const script: Firebot.CustomScript<Params> = {
  getScriptManifest: () => {
    return {
      name: "Tiltify Integration",
      description: "A Tiltify integration for Firebot",
      author: "cozyGalvinism",
      version: "1.0.0",
      firebotVersion: "5",
      startupOnly: true
    };
  },
  getDefaultParameters: () => {
    return {};
  },
  run: (runRequest) => {
    const { logger } = runRequest.modules;
    logger.info("Registering Tiltify integration.");
    register(runRequest);
  },
};

export default script;
