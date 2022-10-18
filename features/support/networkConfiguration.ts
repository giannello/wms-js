import {When} from "@cucumber/cucumber";

When('I configure the channel {int} and the PAN ID {string}', async function (channel: number, panId: string) {
    try {
        this['response'] = await this['wms'].configureNetwork(channel, panId);
    } catch (e) {
        this['response'] = e;
    }
});
