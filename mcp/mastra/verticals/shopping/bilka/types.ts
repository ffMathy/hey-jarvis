// Product catalog search interfaces
export interface ProductAttribute {
  attributeID: string;
  attributeName: string;
  attributeIconID: string;
  attributeNameAndIcon: string;
}

export interface ProductEnergyInfo {
  rating: string;
  label: string;
  scale: string;
  color_code: string;
  data_sheet: string;
}

export interface ProductInfoItem {
  type: number;
  title: string;
  value: string;
}

export interface ProductInfo {
  code: string;
  title: string;
  items: ProductInfoItem[];
}

export interface HighlightResult {
  value: string;
  matchLevel: string;
  fullyHighlighted?: boolean;
  matchedWords: string[];
}

export interface ProductHighlightResult {
  searchHierachy: HighlightResult[];
  name: HighlightResult;
  manufacturer: HighlightResult;
  brand: HighlightResult;
  subBrand: HighlightResult;
  properties: HighlightResult[];
  attributes: {
    attributeID: HighlightResult;
    attributeName: HighlightResult;
    attributeIconID: HighlightResult;
    attributeNameAndIcon: HighlightResult;
  }[];
  productName: HighlightResult;
  alternativeSearchWords: HighlightResult[];
}

export interface CatalogProduct {
  name: string;
  description: string;
  brand: string;
  subBrand: string;
  units: number;
  unitsOfMeasure: string;
  countryOfOrigin: string[];
  netcontent: string;
  properties: string[];
  attributes: ProductAttribute[];
  energyInfo: ProductEnergyInfo;
  safetyIcons: unknown[];
  safetyTexts: unknown[];
  images: string[];
  productType: string;
  infos: ProductInfo[];
  objectID: string;
  price: number;
}

export interface SearchExtensions {
  queryCategorization: {
    count: number;
    normalizedQuery: string;
  };
}

export interface ProcessingTimings {
  _request: {
    roundTrip: number;
  };
  extensions: number;
  rules: number;
  total: number;
}

export interface SearchResult {
  hits: CatalogProduct[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  exhaustiveNbHits: boolean;
  exhaustiveTypo: boolean;
  exhaustive: {
    nbHits: boolean;
    typo: boolean;
  };
  query: string;
  params: string;
  index: string;
  queryID: string;
  renderingContent: Record<string, unknown>;
  extensions: SearchExtensions;
  processingTimeMS: number;
  processingTimingsMS: ProcessingTimings;
  serverTimeMS: number;
}

export interface ProductCatalogResponse {
  results: SearchResult[];
}

// Cart response interfaces
export interface BilkaCartAttribute {
  attributeID: string;
  attributeName: string;
  attributeIconID: string;
  attributeNameAndIcon: string;
}

export interface BilkaCartProduct {
  objectID: number;
  name: string;
  link: string;
  article: string;
  price: number;
  brand: string;
  subBrand: string;
  countryOfOrigin: string[];
  units: number;
  unitsOfMeasure: string;
  unitsOfMeasurePrice: number;
  unitsOfMeasureOfferPrice: number;
  unitsOfMeasurePriceUnit: string;
  properties: string[];
  attributes: BilkaCartAttribute[];
  productType: string;
  multipromo: number;
  imageGUIDs: Record<string, string>;
  categories: {
    lvl0: string[];
    lvl1: string[];
    lvl2: string[];
  };
  blockedByHoliday: boolean;
  msg: string;
  cpOffer: boolean;
  cpOfferPrice: number | null;
  cpOfferAmount: number;
  cpOfferId: number;
  cpOfferMsg: string;
  offerMax: number;
  offerMaxDescription: string;
  ageCode: number;
}

export interface BilkaCartOrderLine {
  subtotal: number;
  net_subtotal: number;
  quantity: number;
  amount: number;
  net_unitprice: number;
  unitprice: number;
  sort: number;
  product: BilkaCartProduct;
  unavailable_reason: string;
  discounts: unknown[];
  deposits: unknown[];
  replacement: unknown;
  returns: unknown[];
  pickedCountryOfOrigin: string;
  comment: string;
  strikethrough: unknown;
  tagline: unknown;
  children: unknown[];
}

export interface BilkaCartLine {
  orderlines: BilkaCartOrderLine[];
  discounts: unknown[];
}

export interface BilkaCartSection {
  headline: string;
  type: string;
  lines: BilkaCartLine[];
}

export interface BilkaCartSpecification {
  text: string;
  value: number;
}

export interface BilkaCartStat {
  amount: number;
  diff: number;
  price: number;
  price_vat: number;
  serv_amount: number;
  serv_diff: number;
  serv_price: number;
  prod_amount: number;
  prod_amount_no_deposits: number;
  prod_diff: number;
  prod_price: number;
  ageCode: number;
  verified_ageCode: number;
  promo: number;
  oos: boolean;
  has_replacements: boolean;
  blockedByHoliday: boolean;
  deposit: number;
  deposit_amount: number;
  deposit_diff: number;
  delivery_price: number;
  is_member: number;
  membership_offer_discount: number;
  personalized_offer_discount: number;
  packing: number;
  packaging_price: number;
  price_no_promo: number;
  subtotal_no_promo: number;
  uncollected_fee: unknown;
  global_discounts: unknown[];
  vouchers: unknown[];
  minimum_left: number;
  minimum_left_text: string;
  specifications: BilkaCartSpecification[];
}

export interface BilkaDeliveryAddress {
  id: string;
  dawa_uid: unknown;
  name: string;
  address: string;
  street: string;
  zip: string;
  city: string;
  sid: string;
  lat: string;
  lng: string;
  recipient_name: string;
  facility: number;
  minimum_buy: number;
  blockbit: number;
  nextAvailableDeliveryDate: string;
  currentDeliveryDate: string;
  missing_hd_address: boolean;
  accessconditions_required: boolean;
  hd_available: boolean;
  temporary_zipcode: unknown;
}

export interface BilkaDeliveryDate {
  displayDeliveryDate: string;
  deliveryDate: string;
  deliveryDay: string;
  intervalStart: string;
  intervalEnd: string;
  closed: number;
  customer_chosen_pickupzone: string;
  message: string;
  order_id: string;
  delivery_message: string;
}

export interface BilkaCartResponse {
  stat: BilkaCartStat;
  lines: BilkaCartSection[];
  messages: unknown[];
  has_b2b_organisations: boolean;
  company: unknown;
  is_ski: boolean;
  hd_available: boolean;
  missing_hd_address: boolean;
  blockbit: number;
  replacement_setting: number;
  ageRestrictionEnabled: boolean;
  deliveryAddress: BilkaDeliveryAddress;
  deliveryDate: BilkaDeliveryDate;
  checkoutconsent: unknown[];
  eid: number;
  uid: number;
  tid: string;
  info_object: unknown;
}
