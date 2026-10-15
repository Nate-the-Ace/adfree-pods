export const WORKER = 'https://adfree-pods.ndschonegg.workers.dev';

const CZM = 'https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1';

// Cool Zone Media shows, all Omny-hosted.
const ART = (p) => `https://is1-ssl.mzstatic.com/image/thumb/${p}/300x300bb.jpg`;

export const FEEDS = [
  { name: 'Knowledge Fight Country', art: ART('Podcasts221/v4/17/34/d5/1734d503-7c35-8601-3a09-59c58796272a/mza_17274028366336417245.jpg'), url: `${CZM}/79e9a3f8-e7fd-4b7b-ad5c-b4ba0139f9ae/756a2948-13e0-4c8b-ae8f-b4ba0139f9bf/podcast.rss` },
  { name: 'Behind the Bastards', art: ART('Podcasts221/v4/ee/82/58/ee8258d4-32a6-eae8-ddde-d13113a6baee/mza_2590417236454661582.jpg'), url: `${CZM}/e5f91208-cc7e-4726-a312-ae280140ad11/d64f756d-6d5e-4fae-b24f-ae280140ad36/podcast.rss` },
  { name: 'It Could Happen Here', art: ART('Podcasts211/v4/00/fa/18/00fa186b-20f5-7e82-2882-5c6d4d0feedc/mza_13814382296146294027.jpg'), url: `${CZM}/78d30acb-8463-4c40-a5ae-ae2d0145c9ff/bc7f369b-dce6-43c2-897e-ae2d0145ca12/podcast.rss` },
  { name: 'Better Offline', art: ART('Podcasts221/v4/c8/a1/3c/c8a13c5f-7295-bc72-6152-db1cf5fbd405/mza_760841200511424832.jpg'), url: `${CZM}/cf0c25ad-cf01-4da5-ae1c-b0fc015f790e/53ed270b-7147-4f70-81c2-b0fc015fe4ed/podcast.rss` },
  { name: 'Cool People Who Did Cool Stuff', art: ART('Podcasts211/v4/48/aa/91/48aa9130-f795-bf5f-a00b-aed60fcfbacf/mza_14716879842823548197.jpg'), url: `${CZM}/45bcda9a-4724-45c0-82ca-ae7f00e1dd18/f21245f2-a297-42f7-a016-ae7f00e390c4/podcast.rss` },
  { name: 'Hood Politics with Prop', art: ART('Podcasts126/v4/12/52/02/12520240-67c0-182d-699f-39a593f41454/mza_18071304291313615327.jpg'), url: `${CZM}/7e1493c7-ebf2-4878-bd99-ae3900554de8/71ddab40-adc1-47f6-b7df-ae3900554dff/podcast.rss` },
  { name: 'Ghost Church by Jamie Loftus', art: ART('Podcasts211/v4/3d/f6/91/3df69100-8182-468a-59d5-11d099be973c/mza_18071634405969007278.jpg'), url: `${CZM}/e3a389d1-2026-4354-a3a2-ae780151014c/fc43d471-035b-486d-b97d-ae780151c077/podcast.rss` },
  // Not Cool Zone: first show from another distributor (Libsyn). See docs/research/.
  { name: 'The Know Rogan Experience', art: ART('Podcasts211/v4/bc/47/ec/bc47ecd7-1e8a-23b0-ed37-649c44c50777/mza_7718141950099779240.png'), url: 'https://rss.libsyn.com/shows/561260/destinations/4849865.xml' },
];
