/**
 * Optional startup auto-provisioning for Plivo Application webhooks.
 *
 * Creates or updates a Plivo Application so answer_url / hangup_url point at
 * this server, and optionally attaches PLIVO_PHONE_NUMBER to that application.
 *
 * Uses the documented Application and Number REST APIs via the plivo Node SDK:
 * https://plivo.com/docs/account/api/application
 * https://plivo.com/docs/numbers/account-phone-numbers
 */

import plivo from "plivo";

export type ProvisionResult = {
  appId: string;
  answerUrl: string;
  hangupUrl: string;
  numberAttached: boolean;
};

function publicHttpsBase(hostname: string): string {
  const cleaned = hostname.replace(/\/$/, "");
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned.replace(/^http:\/\//, "https://");
  }
  return `https://${cleaned}`;
}

export async function provisionPlivoApplication(opts: {
  authId: string;
  authToken: string;
  hostname: string;
  phoneNumber?: string;
  appId?: string;
  appName?: string;
}): Promise<ProvisionResult> {
  const client = new plivo.Client(opts.authId, opts.authToken);
  const base = publicHttpsBase(opts.hostname);
  const answerUrl = `${base}/answer`;
  const hangupUrl = `${base}/hangup`;
  const appName = opts.appName || "xai-plivo-telephony";

  // SDK typings mark many optional fields as required; cast partial updates.
  const appParams: any = {
    answerUrl,
    answerMethod: "POST",
    hangupUrl,
    hangupMethod: "POST",
  };

  let appId = opts.appId;

  if (appId) {
    await client.applications.update(appId, appParams);
    console.log(`[provision] Updated Plivo Application ${appId}`);
  } else {
    const listed: any = await client.applications.list({ limit: 20 } as any);
    const objects: any[] = listed.objects || [];
    const existing = objects.find(
      (app: any) => (app.appName || app.app_name || app.name) === appName,
    );

    if (existing) {
      appId = existing.appId || existing.app_id || existing.id;
      await client.applications.update(appId!, appParams);
      console.log(`[provision] Reused Plivo Application ${appId} (${appName})`);
    } else {
      const created: any = await client.applications.create(appName, appParams);
      appId = created.appId || created.app_id || created.id;
      console.log(`[provision] Created Plivo Application ${appId} (${appName})`);
    }
  }

  if (!appId) {
    throw new Error("Failed to resolve Plivo Application ID after provisioning");
  }

  let numberAttached = false;
  if (opts.phoneNumber) {
    const number = opts.phoneNumber.replace(/^\+/, "");
    await client.numbers.update(number, { appId } as any);
    numberAttached = true;
    console.log(`[provision] Attached ${opts.phoneNumber} to Application ${appId}`);
  }

  return { appId, answerUrl, hangupUrl, numberAttached };
}
