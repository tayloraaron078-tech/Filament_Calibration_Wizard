import { HttpError, readRawBody, sendError, sendNoContent } from '../http.ts';
import type { PhotoMetaRow } from '../db.ts';
import type { RouteHandler } from '../types.ts';

const REQUIRED_QUERY_PARAMS = ['projectId', 'stepId', 'attemptId', 'createdAt', 'name', 'type'] as const;

function readPhotoMeta(url: URL, id: string): PhotoMetaRow {
  const values: Record<string, string> = {};
  for (const key of REQUIRED_QUERY_PARAMS) {
    const value = url.searchParams.get(key);
    if (!value) {
      throw new HttpError(400, `Missing required query param: ${key}`);
    }
    values[key] = value;
  }
  return {
    id,
    projectId: values.projectId,
    stepId: values.stepId,
    attemptId: values.attemptId,
    createdAt: values.createdAt,
    name: values.name,
    type: values.type
  };
}

export const getPhoto: RouteHandler = ({ res, db, params }) => {
  const photo = db.getPhoto(params.id);
  if (!photo) {
    sendError(res, 404, 'Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': photo.type, 'Content-Length': photo.data.length });
  res.end(Buffer.from(photo.data));
};

export const putPhoto: RouteHandler = async ({ req, res, db, params, url }) => {
  const meta = readPhotoMeta(url, params.id);
  const data = await readRawBody(req);
  db.upsertPhoto(meta, data);
  sendNoContent(res);
};

export const deletePhoto: RouteHandler = ({ res, db, params }) => {
  db.deletePhoto(params.id);
  sendNoContent(res);
};
