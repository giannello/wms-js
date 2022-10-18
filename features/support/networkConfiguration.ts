import {When} from "@cucumber/cucumber";

When('I configure the channel {int} and the PAN ID {string}', async function (channel: number, panId: string) {
    try {
        this['response'] = await this['wms'].configureNetwork(channel, panId);
    } catch (e) {
        this['response'] = e;
    }
});

When('I configure the encryption key {string}', async function (encryptionKey) {
    try {
        this['response'] = await this['wms'].configureEncryptionKey(encryptionKey);
    } catch (e) {
        this['response'] = e;
    }
});
