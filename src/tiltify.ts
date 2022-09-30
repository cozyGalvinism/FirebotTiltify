import { Integration, IntegrationController, IntegrationData, IntegrationDefinition, IntegrationManager, LinkData } from '@crowbartools/firebot-custom-scripts-types/types/modules/integration-manager';
import { EventManager, EventSource } from '@crowbartools/firebot-custom-scripts-types/types/modules/event-manager';
import { EventFilter } from '@crowbartools/firebot-custom-scripts-types/types/modules/event-filter-manager';
import { EventEmitter } from 'events';
import axios from "axios";
import { RunRequest } from '@crowbartools/firebot-custom-scripts-types';
import { Logger } from '@crowbartools/firebot-custom-scripts-types/types/modules/logger';
import { Effects } from '@crowbartools/firebot-custom-scripts-types/types/effects';
import { ReplaceVariableManager } from '@crowbartools/firebot-custom-scripts-types/types/modules/replace-variable-manager';

let eventManager: EventManager;
let db: any;
let logger: Logger;

const TILTIFY_BASE_URL = "https://tiltify.com/api/v3/";

const EVENT_SOURCE_ID = "tiltify";
const EventId = {
    DONATION: "donation",
};

const eventSourceDefinition: EventSource = {
    id: EVENT_SOURCE_ID,
    name: "Tiltify",
    events: [
        {
            id: EventId.DONATION,
            name: "Donation",
            description: "When someone donates to you via Tiltify.",
            cached: false,
            manualMetadata: {
                from: "Tiltify",
                donationAmount: 4.2,
                rewardId: null,
                comment: "Thanks for the stream!",
                pollOptionId: null,
                challengeId: null,
                campaignInfo: {
                    name: "My Campaign",
                    cause: "Save the Children",
                    causeLegalName: "Save the Children Inc",
                    fundraisingGoal: 1000,
                    originalGoal: 500,
                    supportingRaised: 500,
                    amountRaised: 1000,
                    totalRaised: 1500,
                }
            },
        }
    ]
};

const integrationDefinition: IntegrationDefinition = {
    id: "tiltify",
    name: "Tiltify",
    description: "Tiltify donation events",
    connectionToggle: true,
    configurable: true,
    settingCategories: {
        integrationSettings: {
            title: "Integration Settings",
            settings: {
                pollInterval: {
                    title: "Poll Interval",
                    type: "number",
                    default: 5,
                    description: "How often to poll Tiltify for new donations (in seconds).",
                }
            }
        },
        campaignSettings: {
            title: "Campaign Settings",
            settings: {
                campaignId: {
                    title: "Campaign ID",
                    type: "string",
                    description: "ID of the running campaign to fetch donations for.",
                    default: "",
                }
            },
        }
    },
    linkType: "id",
    idDetails: {
        steps: 
`1. Log in to [Tiltify](https://dashboard.tiltify.com/)

2. Go to your \`My account\` and then to the \`Connected accounts\` tab

3. Click \`Your applications\` and then \`create application\`

4. In the form, enter a \`Firebot\` as the name and enter \`http://localhost\` as the redirect URL

5. Copy the access token and paste it into the field below`
    }
};

type TiltifyCampaign = {
    data: {
        id: number;
        name: string;
        causeId: number;
        fundraiserGoalAmount: number;
        originalFundraiserGoal: number;
        amountRaised: number;
        supportingAmountRaised: number;
        totalAmountRaised: number;
    }
};

type TiltifyCause = {
    data: {
        id: number;
        name: string;
        legalName: string;
    }
};

class TiltifyIntegration extends EventEmitter implements IntegrationController {
    timeout: NodeJS.Timeout;
    connected: boolean;

    constructor() {
        super();
        this.timeout = null;
        this.connected = false;
    }

    init() {}

    link() {}
    unlink() {}

    connect(integrationData: IntegrationData) {
        const { accountId } = integrationData;

        if (accountId == null || accountId === "") {
            this.emit("disconnected", integrationDefinition.id);
            return;
        }

        if (integrationData.userSettings == null || integrationData.userSettings.campaignSettings == null) {
            this.emit("disconnected", integrationDefinition.id);
            this.connected = false;
            return;
        }

        const { campaignId } = integrationData.userSettings.campaignSettings;
        if (campaignId == null || campaignId === "") {
            this.emit("disconnected", integrationDefinition.id);
            this.connected = false;
            return;
        }

        let campaignInfo: TiltifyCampaign = null;
        let causeInfo: TiltifyCause = null;
        (async function getCampaignInfo() {
            var response = await axios.get(TILTIFY_BASE_URL + "campaigns/" + campaignId, {
                headers: {
                    Authorization: "Bearer " + accountId
                }
            });
            campaignInfo = response.data as TiltifyCampaign;
            var response = await axios.get(TILTIFY_BASE_URL + "causes/" + campaignInfo.data.causeId, {
                headers: {
                    Authorization: "Bearer " + accountId
                }
            });
            causeInfo = response.data as TiltifyCause;
        })();

        this.timeout = setInterval(async () => {
            var lastId: number;
            try {
                lastId = db.getData(`/tiltify/${campaignId}/lastId`);
                logger.debug("load: lastId", lastId);
            } catch (e) {
                lastId = -1;
            }

            let ids: any[] = [];
            try {
                ids = db.getData(`/tiltify/${campaignId}/ids`);
            } catch (e) {
                db.push(`/tiltify/${campaignId}/ids`, []);
            }
            logger.debug("load: ids", ids);

            if (lastId == -1) {
                var response = await axios.get(TILTIFY_BASE_URL + "campaigns/" + campaignId + "/donations", {
                    headers: {
                        Authorization: "Bearer " + accountId,
                    }
                });
            } else {
                var response = await axios.get(TILTIFY_BASE_URL + "campaigns/" + campaignId + "/donations?after=" + lastId, {
                    headers: {
                        Authorization: "Bearer " + accountId,
                    }
                });
            }
            
            if (response.status != 200) {
                console.log("Error fetching donations: " + response.status);
                return;
            }

            const { data } = response;
            var sortedDonations = data.data.sort((a: any, b: any) => a.completedAt - b.completedAt);

            sortedDonations.forEach((donation: { id: number; amount: number; name: string; comment: string; completedAt: number; rewardId?: number; pollOptionId?: number; challengeId?: number; }) => {
                if (db.getData(`/tiltify/${campaignId}/ids`).includes(donation.id)) {
                    return;
                }
                
                lastId = donation.id;

                logger.info(`Donation from ${donation.name} for $${donation.amount}. Reward: ${donation.rewardId}`);
                eventManager.triggerEvent(EVENT_SOURCE_ID, EventId.DONATION, {
                    from: donation.name,
                    donationAmount: donation.amount,
                    rewardId: donation.rewardId,
                    comment: donation.comment,
                    pollOptionId: donation.pollOptionId,
                    challengeId: donation.challengeId,
                    campaignInfo: {
                        name: campaignInfo.data.name,
                        cause: causeInfo.data.name,
                        causeLegalName: causeInfo.data.legalName,
                        fundraisingGoal: campaignInfo.data.fundraiserGoalAmount,
                        originalGoal: campaignInfo.data.originalFundraiserGoal,
                        supportingRaised: campaignInfo.data.supportingAmountRaised,
                        amountRaised: campaignInfo.data.amountRaised,
                        totalRaised: campaignInfo.data.totalAmountRaised,
                    }
                }, false);

                ids.push(donation.id);
                db.push(`/tiltify/${campaignId}/ids`, ids);
            });

            logger.debug("save: lastId", lastId);
            db.push(`/tiltify/${campaignId}/lastId`, lastId);
            
        }, (integrationData.userSettings.integrationSettings.pollInterval as number) * 1000);

        this.emit("connected", integrationDefinition.id);
        this.connected = true;
    }

    disconnect() {
        if (this.timeout) {
            clearInterval(this.timeout);
        }
        this.connected = false;
        this.emit("disconnected", integrationDefinition.id);
    }

    onUserSettingsUpdate(integrationData: IntegrationData) {
        if (this.connected) {
            this.disconnect();
        }
        this.connect(integrationData);
    }
}

const integration: Integration = {
    definition: integrationDefinition,
    integration: new TiltifyIntegration(),
};

async function fetchRewards(accountId: string, campaignId: string) {
    try {
        const response = await axios.get(TILTIFY_BASE_URL + "campaigns/" + campaignId + "/rewards", {
            headers: {
                Authorization: "Bearer " + accountId,
            }
        });
        return response.data.data;
    } catch (e) {
        console.log(e);
        return [];
    }
}

async function fetchPollOptions(accountId: string, campaignId: string) {
    try {
        const response = await axios.get(TILTIFY_BASE_URL + "campaigns/" + campaignId + "/polls", {
            headers: {
                Authorization: "Bearer " + accountId,
            }
        });
        return response.data.data.reduce((acc: any[], poll: any) => acc.concat(poll.options), []);
    } catch (e) {
        console.log(e);
        return [];
    }
}

async function fetchChallenges(accountId: string, campaignId: string) {
    try {
        const response = await axios.get(TILTIFY_BASE_URL + "campaigns/" + campaignId + "/challenges", {
            headers: {
                Authorization: "Bearer " + accountId,
            }
        });
        return response.data.data;
    } catch (e) {
        console.log(e);
        return [];
    }
}

async function fetchCampaigns(accountId: string) {
    try {
        const userInfo = await axios.get(TILTIFY_BASE_URL + "user", {
            headers: {
                Authorization: "Bearer " + accountId,
            }
        });
        const userId = userInfo.data.data.id;

        const response = await axios.get(TILTIFY_BASE_URL + "users/" + userId + "/campaigns", {
            headers: {
                Authorization: "Bearer " + accountId,
            }
        });
        return response.data.data;
    } catch (e) {
        console.log(e);
        return [];
    }
}

const RewardFilter: EventFilter = {
    id: "tcu:reward-id",
    name: "Tiltify Reward",
    description: "Filter by the Tiltify reward.",
    events: [
        { eventSourceId: EVENT_SOURCE_ID, eventId: EventId.DONATION },
    ],
    comparisonTypes: [
        "is",
        "is not"
    ],
    valueType: "preset",
    predicate: (filterSettings, eventData) => {
        const rewardId = eventData.eventMeta.rewardId;

        switch (filterSettings.comparisonType) {
            case "is": {
                return Promise.resolve(rewardId == filterSettings.value);
            }
            case "is not": {
                return Promise.resolve(rewardId != filterSettings.value);
            }
            default: {
                return Promise.resolve(false);
            }
        }
    },
    presetValues: (backendCommunicator) => {
        return backendCommunicator.fireEventAsync("get-tiltify-rewards").then((rewards: any) => {
            return rewards.map((r: any) => ({value: r.id, display: r.name}));
        });
    },
};

const PollOptionFilter: EventFilter = {
    id: "tcu:poll-option-id",
    name: "Tiltify Poll Option",
    description: "Filter by the Tiltify poll option.",
    events: [
        { eventSourceId: EVENT_SOURCE_ID, eventId: EventId.DONATION },
    ],
    comparisonTypes: [
        "is",
        "is not"
    ],
    valueType: "preset",
    predicate: (filterSettings, eventData) => {
        const pollOptionId = eventData.eventMeta.pollOptionId;
        
        switch (filterSettings.comparisonType) {
            case "is": {
                return Promise.resolve(pollOptionId == filterSettings.value);
            }
            case "is not": {
                return Promise.resolve(pollOptionId != filterSettings.value);
            }
            default: {
                return Promise.resolve(false);
            }
        }
    },
    presetValues: (backendCommunicator) => {
        return backendCommunicator.fireEventAsync("get-tiltify-poll-options").then((pollOptions: any) => {
            return pollOptions.map((r: any) => ({value: r.id, display: r.name}));
        });
    },
};

const ChallengeFilter: EventFilter = {
    id: "tcu:challenge-id",
    name: "Tiltify Challenge",
    description: "Filter by the Tiltify challenge.",
    events: [
        { eventSourceId: EVENT_SOURCE_ID, eventId: EventId.DONATION },
    ],
    comparisonTypes: [
        "is",
        "is not"
    ],
    valueType: "preset",
    predicate: (filterSettings, eventData) => {
        const challengeId = eventData.eventMeta.challengeId;
        
        switch (filterSettings.comparisonType) {
            case "is": {
                return Promise.resolve(challengeId == filterSettings.value);
            }
            case "is not": {
                return Promise.resolve(challengeId != filterSettings.value);
            }
            default: {
                return Promise.resolve(false);
            }
        }
    },
    presetValues: (backendCommunicator) => {
        return backendCommunicator.fireEventAsync("get-tiltify-challenges").then((challenges: any) => {
            return challenges.map((r: any) => ({value: r.id, display: r.name}));
        });
    },
};

function registerReplaceVariables(manager: ReplaceVariableManager) {
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationFrom',
            description: 'The name of who sent a Tiltify donation',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["text"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const from = (trigger.metadata.eventData && trigger.metadata.eventData.from) || "Unknown User";

            return from;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationAmount',
            description: 'The amount of a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const donationAmount = (trigger.metadata.eventData && trigger.metadata.eventData.donationAmount) || 0;

            return donationAmount;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationRewardId',
            description: 'The reward ID of a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const rewardId = (trigger.metadata.eventData && trigger.metadata.eventData.rewardId) || -1;

            return rewardId;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationComment',
            description: 'The comment of a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["text"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const comment = (trigger.metadata.eventData && trigger.metadata.eventData.comment) || "";

            return comment;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignName',
            description: 'The name of the campaign that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["text"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignName = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).name) || "";

            return campaignName;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignCause',
            description: 'The cause of the campaign that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["text"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignCause = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).cause) || "";

            return campaignCause;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaigCauseLegal',
            description: 'The legal cause name of the campaign that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["text"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignCauseLegal = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).causeLegalName) || "";

            return campaignCauseLegal;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignFundraisingGoal',
            description: 'The fundraising goal of the cause that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignFundraisingGoal = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).fundraisingGoal) || 0;

            return campaignFundraisingGoal;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignOriginalGoal',
            description: 'The original goal set by the fundraiser of the campaign that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignOriginalGoal = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).originalGoal) || 0;

            return campaignOriginalGoal;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignSupportingRaised',
            description: 'The amount of money raised by supporting campaigns that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignSupportingRaised = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).supportingRaised) || 0;

            return campaignSupportingRaised;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignRaised',
            description: 'The amount of money raised by the campaign that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignRaised = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).amountRaised) || 0;

            return campaignRaised;
        }
    });
    manager.registerReplaceVariable({
        definition: {
            handle: 'tiltifyDonationCampaignTotalRaised',
            description: 'The total amount of money raised by the cause that received a donation from Tiltify',
            triggers: {
                "event": [
                    "tiltify:donation"
                ],
                "manual": true
            },
            possibleDataOutput: ["number"]
        },
        evaluator: function (trigger: Effects.Trigger, ...args: any[]) {
            const campaignTotalRaised = (trigger.metadata.eventData && (trigger.metadata.eventData.campaignInfo as any).totalRaised) || 0;

            return campaignTotalRaised;
        }
    });
}

function register(runRequest: RunRequest) {
    let JsonDb: any = runRequest.modules.JsonDb;
    eventManager = runRequest.modules.eventManager;
    db = new JsonDb("tiltify.json", true, false, "/");
    logger = runRequest.modules.logger;

    runRequest.modules.integrationManager.registerIntegration(integration);
    runRequest.modules.eventManager.registerEventSource(eventSourceDefinition);
    runRequest.modules.eventFilterManager.registerFilter(RewardFilter);
    runRequest.modules.eventFilterManager.registerFilter(PollOptionFilter);
    runRequest.modules.eventFilterManager.registerFilter(ChallengeFilter);
    runRequest.modules.frontendCommunicator.fireEventAsync("integrationsUpdated", {});

    registerReplaceVariables(runRequest.modules.replaceVariableManager);

    runRequest.modules.frontendCommunicator.onAsync("get-tiltify-rewards", () => {
        let integration = runRequest.modules.integrationManager.getIntegrationDefinitionById("tiltify");
        if (integration == null || integration.userSettings == null || integration.userSettings.campaignSettings == null || integration.userSettings.campaignSettings.campaignId == null || integration.userSettings.campaignSettings.campaignId === "") {
            return Promise.reject("Tiltify integration not found or not configured");
        }
        let accountId = integration.accountId;
        let campaignId = integration.userSettings.campaignSettings.campaignId;

        return fetchRewards(accountId, campaignId);
    });

    runRequest.modules.frontendCommunicator.onAsync("get-tiltify-poll-options", () => {
        let integration = runRequest.modules.integrationManager.getIntegrationDefinitionById("tiltify");
        if (integration == null || integration.userSettings == null || integration.userSettings.campaignSettings == null || integration.userSettings.campaignSettings.campaignId == null || integration.userSettings.campaignSettings.campaignId === "") {
            return Promise.reject("Tiltify integration not found or not configured");
        }
        let accountId = integration.accountId;
        let campaignId = integration.userSettings.campaignSettings.campaignId;

        return fetchPollOptions(accountId, campaignId);
    });

    runRequest.modules.frontendCommunicator.onAsync("get-tiltify-challenges", () => {
        let integration = runRequest.modules.integrationManager.getIntegrationDefinitionById("tiltify");
        if (integration == null || integration.userSettings == null || integration.userSettings.campaignSettings == null || integration.userSettings.campaignSettings.campaignId == null || integration.userSettings.campaignSettings.campaignId === "") {
            return Promise.reject("Tiltify integration not found or not configured");
        }
        let accountId = integration.accountId;
        let campaignId = integration.userSettings.campaignSettings.campaignId;

        return fetchChallenges(accountId, campaignId);
    });

    // TODO: This isn't implemented in the UI yet, as I don't know how to do it.
    runRequest.modules.frontendCommunicator.onAsync("get-tiltify-campaigns", () => {
        let integration = runRequest.modules.integrationManager.getIntegrationDefinitionById("tiltify");
        if (integration == null || integration.accountId == null || integration.accountId === "") {
            return Promise.reject("Tiltify integration not found or not configured");
        }
        let accountId = integration.accountId;

        return fetchCampaigns(accountId);
    });
}

export {
    register
};