import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Authentication and session management
interface AuthTokens {
    sessionInfo: {
        cookieValue: string;
        cookieName: string;
    };
    jwtToken: string;
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
    discounts: any[];
    deposits: any[];
    replacement: any;
    returns: any[];
    pickedCountryOfOrigin: string;
    comment: string;
    strikethrough: any;
    tagline: any;
    children: any[];
}

export interface BilkaCartLine {
    orderlines: BilkaCartOrderLine[];
    discounts: any[];
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
    uncollected_fee: any;
    global_discounts: any[];
    vouchers: any[];
    minimum_left: number;
    minimum_left_text: string;
    delivery_comment: any;
    specifications: BilkaCartSpecification[];
}

export interface BilkaDeliveryAddress {
    id: string;
    dawa_uid: any;
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
    temporary_zipcode: any;
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
    messages: any[];
    has_b2b_organisations: boolean;
    company: any;
    is_ski: boolean;
    hd_available: boolean;
    missing_hd_address: boolean;
    blockbit: number;
    replacement_setting: number;
    ageRestrictionEnabled: boolean;
    deliveryAddress: BilkaDeliveryAddress;
    deliveryDate: BilkaDeliveryDate;
    checkoutconsent: any[];
    eid: number;
    uid: number;
    tid: string;
    info_object: any;
}

let cachedTokens: {
    tokens: AuthTokens | undefined;
    refreshTime: Date;
};

/**
 * Authenticates with Bilka's API and returns session tokens
 */
async function authenticateWithBilka() {
    const cacheDurationInMinutes = 5;
    if (cachedTokens && cachedTokens.refreshTime.getTime() + cacheDurationInMinutes * 60 * 1000 > new Date().getTime()) {
        if (!cachedTokens.tokens) {
            throw new Error('Could not sign in.');
        }

        return cachedTokens.tokens;
    }

    const newCachedTokens: typeof cachedTokens = {
        tokens: undefined,
        refreshTime: new Date(),
    }
    cachedTokens = newCachedTokens;

    // Step 1: Login with credentials to get login token
    const loginResponse = await fetch('https://accounts.eu1.gigya.com/accounts.login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            loginID: process.env.BILKA_EMAIL!,
            password: process.env.BILKA_PASSWORD!,
            apiKey: process.env.BILKA_API_KEY!,
        }),
    });

    const loginData = await loginResponse.json();

    if (!loginData.sessionInfo?.cookieValue) {
        throw new Error('Failed to get login token');
    }

    const authTokens: AuthTokens = {
        sessionInfo: loginData.sessionInfo,
        jwtToken: undefined!,
    };

    // Step 2: Exchange login token for JWT token
    const jwtResponse = await fetch(`https://accounts.eu1.gigya.com/accounts.getJWT?login_token=${authTokens.sessionInfo.cookieValue}&apiKey=${process.env.BILKA_API_KEY}`, {
        method: 'POST',
    });

    const jwtData = await jwtResponse.json();
    if (!jwtData.id_token) {
        throw new Error('Failed to get JWT token');
    }

    authTokens.jwtToken = jwtData.id_token;

    newCachedTokens.tokens = authTokens;
    newCachedTokens.refreshTime = new Date();

    return authTokens;
}

/**
 * Searches for products in the Bilka catalog using Algolia search
 */
export const findProductInCatalog = createTool({
    id: 'find-product-in-catalog',
    description: 'Finds a certain product in the catalogue. The result contains some hits for matching products, and maximum 5 products. Each product is identified by the "objectID" property of the hit. If a hit doesn\'t have an objectID, then don\'t consider it as a valid result. The `storeData` property contains all the items on stock and their price.',
    inputSchema: z.object({
        search_query: z.string().describe('The product to search for, in Danish. For instance, "agurk".')
    }),
    execute: async ({ context }) => {
        const attributesToRetrieve = [
            "objectID",
            "ageCode",
            "article",
            "attributes",
            "blockedByHoliday",
            "brand",
            "countryOfOrigin",
            "blockbit",
            "cpOffer",
            "cpOfferAmount",
            "cpOfferId",
            "cpOfferPrice",
            "description",
            "energyInfo",
            "safetyIcons",
            "safetyTexts",
            "netcontent",
            "imageGUIDs",
            "images",
            "infos",
            "isInCurrentLeaflet",
            "name",
            "objectID",
            "productType",
            "properties",
            "cpOfferFromDate",
            "cpOfferToDate",
            "subBrand",
            "units",
            "unitsOfMeasure",
            "consumerFacingHierarchy",
            "nonsearchable",
            "storeData"
        ];
        const requestBody = {
            requests: [{
                indexName: "prod_BILKATOGO_PRODUCTS",
                params: [
                    `attributesToRetrieve=${encodeURIComponent(JSON.stringify(attributesToRetrieve))}`,
                    `query=${encodeURIComponent(context.search_query)}`,
                    `distinct=false`,
                    `page=0`,
                    `hitsPerPage=5`,
                    `facets=${encodeURIComponent(JSON.stringify([]))}`,
                    `clickAnalytics=true`,
                    `analyticsTags=${encodeURIComponent(JSON.stringify([]))}`,
                    `userToken=${process.env.BILKA_USER_TOKEN}`,
                    `getRankingInfo=false`
                ].join('&'),
            }],
            strategy: "none"
        };

        const response = await fetch('https://f9vbjlr1bk-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.14.3)%3B%20Browser', {
            method: 'POST',
            headers: {
                'X-Algolia-Api-Key': process.env.ALGOLIA_API_KEY!,
                'X-Algolia-Application-Id': process.env.ALGOLIA_APPLICATION_ID!,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    },
});

/**
 * Sets the basket quantity for a certain item
 */
export const setProductBasketQuantity = createTool({
    id: 'set-product-basket-quantity',
    description: 'Sets the basket quantity for a certain item.',
    inputSchema: z.object({
        object_id: z.string().describe('The object ID (found by looking at the objectID property) of the product to adjust the basket quantity of. You get the object ID by searching in the catalogue for new items (and taking the `objectID` property of a product in the hits, or from the existing basket contents (and also taking the `objectID` property of the product from there). This object must come from a product in the catalogue, and cannot be made up.'),
        quantity: z.number().describe('The quantity of the product. For instance, 2.'),
        product_name: z.string().describe('The name of the product.')
    }),
    execute: async ({ context }) => {
        const jwtToken = await authenticateWithBilka();

        const url = `https://api.bilkatogo.dk/api/shop/v6/ChangeLineCount?u=w&productId=${encodeURIComponent(context.object_id)}&count=${context.quantity}&fullCart=0&name=${encodeURIComponent(context.product_name)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'jwt_token': jwtToken.jwtToken,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to set basket quantity: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    },
});

/**
 * Gets the current cart contents
 */
export const getCurrentCartContents = createTool({
    id: 'get-current-cart-contents',
    description: 'Retrieves the current shopping cart contents from Bilka.',
    inputSchema: z.object({}),
    execute: async () => {
        const jwtToken = await authenticateWithBilka();

        const response = await fetch('https://api.bilkatogo.dk/api/shop/v6/Cart?u=w&extra=deliveryAddress,deliveryDate', {
            method: 'GET',
            headers: {
                'jwt_token': jwtToken.jwtToken,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to get cart contents: ${response.status} ${response.statusText}`);
        }

        const cartContents = await response.json() as BilkaCartResponse;
        return cartContents.lines
            .flatMap(x => x.lines)
            .flatMap(x => x.orderlines)
            .filter(x => x.product.units > 0)
            .map(x => ({
                objectID: x.product.objectID,
                name: x.product.name,
                price: x.product.price,
                brand: `${x.product.brand} ${x.product.subBrand}`.trim(),
                units: x.product.units,
                unitsOfMeasure: x.product.unitsOfMeasure,
                quantity: x.quantity,
                totalPrice: x.unitprice * x.quantity,
                attributes: x.product.attributes.map(x => x.attributeName),
                type: x.product.productType,
            }));
    },
});

/**
 * Clears all items from the cart
 */
export const clearCartContents = createTool({
    id: 'clear-cart-contents',
    description: 'Empties the entire shopping cart.',
    inputSchema: z.object({}),
    execute: async () => {
        const jwtToken = await authenticateWithBilka();

        const response = await fetch('https://api.bilkatogo.dk/api/shop/v6/EmptyCart', {
            method: 'GET',
            headers: {
                'jwt_token': jwtToken.jwtToken,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to clear cart: ${response.status} ${response.statusText}`);
        }

        await response.json();
        return { success: true };
    },
});

export const shoppingTools = {
    findProductInCatalog,
    setProductBasketQuantity,
    getCurrentCartContents,
    clearCartContents,
};