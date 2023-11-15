import crypto from 'crypto';
import qs from 'qs';
import apiEnv from "./apiEnv";
import z, { TypeOf } from "zod";
import { TRPCError } from '@trpc/server';
import * as Sentry from '@sentry/node';
import axios from 'axios';

const LOG_HEADER = "[TecentMeeting]";

const sign = (
  secretId: string, secretKey: string,
  httpMethod: string, headerNonce: number,
  headerTimestamp: number, requestUri: string, requestBody: string
) => {
  const tobeSigned = `${httpMethod}\nX-TC-Key=${secretId}&X-TC-Nonce=${headerNonce}&X-TC-Timestamp=${headerTimestamp}` +
    `\n${requestUri}\n${requestBody}`;
  const signature = crypto.createHmac('sha256', secretKey)
    .update(tobeSigned)
    .digest('hex');
  return Buffer.from(signature, "utf8").toString('base64');
};

const tmRequest = async (
  method: 'POST' | 'GET',
  requestUri: string,
  query: Record<string, string | number>,
  body: Record<string, string> = {},
) => {
  const now = Math.floor(Date.now() / 1000);
  const hasQuery = Object.keys(query).length > 0;
  const pathWithQuery = requestUri + (hasQuery ? `?${qs.stringify(query)}` : "");

  // authentication docs location
  // https://cloud.tencent.com/document/product/1095/42413
  const url = "https://api.meeting.qq.com" + pathWithQuery;
  const nonce = Math.floor(Math.random() * 100000);
  const bodyText = method === "GET" ? "" : JSON.stringify(body);

  const signature = sign(
    apiEnv.TM_SECRET_ID,
    apiEnv.TM_SECRET_KEY,
    method,
    nonce,
    now,
    pathWithQuery,
    bodyText
  );

  const headers = {
    // "Accept": "*/*",
    // "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
    "X-TC-Key": apiEnv.TM_SECRET_ID,
    "AppId": apiEnv.TM_ENTERPRISE_ID,
    "SdkId": apiEnv.TM_APP_ID,
    "X-TC-Timestamp": "" + now,
    "X-TC-Nonce": "" + nonce,
    "X-TC-Signature": signature,
    "X-TC-Registered": "1"
  };

  try {
    const response = await axios({
      method,
      url,
      headers,
    });
    //Tencent Meeting APIs will still return an empty object with status 200 
    //even using wrong or invalid inputs that has the right format such expired meeting record ids 
    if (JSON.stringify(response.data) === '{}') {
      const error = undefinedResponse();
      Sentry.captureException(error);
      throw error;
    };

    return response.data;

  } catch (error: any) {
    // Invalid request to Tencent RestAPI would return error with 400 or 500
    if (error.response) {
      const e = failedRequest(error.response.status, error.data);
      Sentry.captureException(e);
      throw e;
    } else { // for any other unexpected errors
      Sentry.captureException(error);
      throw error;
    }
  }
};

/**
 * Create a meeting.
 * 
 * https://cloud.tencent.com/document/product/1095/42417
 */
export async function createMeeting(
  tmUserId: string,
  subject: string,
  startTimeSecond: number,
  endTimeSecond: number,
) {
  console.log(LOG_HEADER, `createMeeting('${subject}', ${startTimeSecond}, ${endTimeSecond})`);

  /* Sample request result:
  {
    "meeting_number": 1,
    "meeting_info_list": [
      {
        "subject": "test meeting ts4",
        "meeting_id": "8920608318088532478",
        "meeting_code": "123371270",
        "type": 1,
        "join_url": "https://meeting.tencent.com/dm/49fYCUGV0YHe",
        "hosts": [
          {
            "userid": "1764d9d81a924fdf9269b7a54e519f30"
          }
        ],
        "start_time": "1683093659",
        "end_time": "1683136859",
        "settings": {
          "mute_enable_join": true,
          "allow_unmute_self": true,
          "mute_all": true,
          "mute_enable_type_join": 1
        },
        "meeting_type": 0,
        "enable_live": false,
        "media_set_type": 0,
        "location": "",
        "host_key": "123456"
      }
    ]
  }*/

  const zRes = z.object({
    meeting_number: z.number(),
    meeting_info_list: z.array(z.object({
      subject: z.string(),
      meeting_id: z.string(),
      meeting_code: z.string(),
      type: z.number(),
      join_url: z.string().url(),
      hosts: z.array(z.object({
        userid: z.string(),
      })),
      start_time: z.string(),
      end_time: z.string(),
      settings: z.object({
        mute_enable_join: z.boolean(),
        allow_unmute_self: z.boolean(),
        mute_all: z.boolean(),
        mute_enable_type_join: z.number(),
      }),
      meeting_type: z.number(),
      enable_live: z.boolean(),
      media_set_type: z.number(),
      location: z.string(),
      host_key: z.string().optional(),
    })),
  });

  const res = await tmRequest('POST', '/v1/meetings', {}, {
    userid: tmUserId,
    instanceid: "1",
    subject: subject,
    start_time: "" + startTimeSecond,
    end_time: "" + endTimeSecond,
    type: "0", // 0: scheduled, 1: fast
  });

  return zRes.parse(res);
}

const paginationNotSupported = () => new TRPCError({
  code: 'METHOD_NOT_SUPPORTED',
  message: "Pagination isn't supported",
});

//https://cloud.tencent.com/document/product/1095/42700
const failedRequest = (statusCode: number, data: string) => new TRPCError({
  code: 'BAD_REQUEST',
  message: `Tencent Meeting Rest API request failed, status Code:${statusCode}`,
  cause: data,
});

// This error is thrown when Tencent RestAPI returns status 200 and an empty object
const undefinedResponse = () => new TRPCError({
  code: 'NOT_FOUND',
  message: 'Response data is undefined',
  cause: 'check validties of Tencent Meeting API inputs'
});

/**
 * List meeting info of the input meeting and tencent user id
 * https://cloud.tencent.com/document/product/1095/93432
 */
export async function getMeeting(meetingId: string, tmUserId: string) {
  console.log(LOG_HEADER, 'listMeetings()');
  const zRes = z.object({
    meeting_number: z.number(),
    meeting_info_list: z.array(z.object({
      subject: z.string(),
      meeting_id: z.string(),
      meeting_code: z.string(),
      status: z.string(),
      //type: 0,
      join_url: z.string(),
      start_time: z.string(),
      end_time: z.string(),
      // "meeting_type": 6,
      // "recurring_rule": {"recurring_type": 3, "until_type": 1, "until_count": 20},
      // "current_sub_meeting_id": "1679763600",
      // "has_vote": false,
      // "current_hosts": [{"userid": "1764d9d81a924fdf9269b7a54e519f30"}],
      // "join_meeting_role": "creator",
      // "location": "",
      // "enable_enroll": false,
      // "enable_host_key": false,
      // "time_zone": "",
      // "disable_invitation": 0
    }))
  });

  return zRes.parse(
    await tmRequest('GET', '/v1/meetings/' + meetingId,
      {
        userid: tmUserId,
        instanceid: "1",
      })
  ).meeting_info_list[0];
}

/**
 * List meeting recordings since 31 days ago (max allowed date range).
 * 
 * https://cloud.tencent.com/document/product/1095/51189
 */
export async function listRecords(tmUserId: string) {
  console.log(LOG_HEADER, 'listRecords()');
  const zRecordMeetings = z.object({
    meeting_record_id: z.string(), // needed for script download
    // meeting_id: z.string(),
    // meeting_code: z.string(),
    // host_user_id: z.string(),
    // media_start_time: z.number(),
    subject: z.string(),
    state: z.number(), // 3 - ready for download
    record_files: z.array(
      z.object({
        record_file_id: z.string(),
        record_start_time: z.number(),
        record_end_time: z.number(),
        // record_size: z.number(),
        // sharing_state: z.number(),
        // required_same_corp: z.boolean(),
        // required_participant: z.boolean(),
        // password: z.string(),
        // sharing_expire: z.number(),
        // allow_download: z.boolean()
      })
    ).optional()
  });
  const zRes = z.object({
    total_count: z.number(),
    // current_size: z.number(),
    // current_page: z.number(),
    total_page: z.number(),
    record_meetings: z.array(zRecordMeetings).optional()
  });

  var ret: TypeOf<typeof zRecordMeetings>[] = [];
  var page = 1;
  while (true) {
    const res = zRes.parse(await tmRequest('GET', '/v1/records', {
      userid: tmUserId,
      // 31d is earliest allowed date
      start_time: JSON.stringify(Math.trunc(Date.now() / 1000 - 31 * 24 * 3600)),
      end_time: JSON.stringify(Math.trunc(Date.now() / 1000)),
      page_size: 20,  // max page size
      page
    }));
    ret = ret.concat(res.record_meetings || []);
    if (page >= res.total_page) break;
    page++;
  }
  return ret;
}

/**
 * Get record file download URLs given a meeting record id retrieved from listRecords().
 * 
 * https://cloud.tencent.com/document/product/1095/51174
 */
export async function getRecordURLs(meetingRecordId: string, tmUserId: string) {
  console.log(LOG_HEADER, `getRecordURLs("${meetingRecordId}")`);
  const zRes = z.object({
    // meeting_record_id: z.string(),
    // meeting_id: z.string(),
    // meeting_code: z.string(),
    // subject: z.string(),
    // total_count: z.number(),
    // current_size: z.number(),
    total_page: z.number(),
    record_files: z.array(
      z.object({
        record_file_id: z.string(),
        // view_address: z.string().url(),
        // download_address: z.string().url(),
        // download_address_file_type: z.string(),
        // audio_address: z.string().url(),
        // audio_address_file_type: z.string(),
        meeting_summary: z.array(
          z.object({
            download_address: z.string().url(),
            file_type: z.string(),
          })
        ).optional()
      })
    )
  });

  const res = zRes.parse(await tmRequest('GET', '/v1/addresses', {
    meeting_record_id: meetingRecordId,
    userid: tmUserId,
  }));

  if (res.total_page != 1) throw paginationNotSupported();
  return res;
}

// Uncomment and modify this line to debug TM APIs.
// listRecords().then(res => console.log(JSON.stringify(res, null, 2)));
