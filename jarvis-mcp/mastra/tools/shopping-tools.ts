import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Authentication and session management
interface AuthTokens {
    loginToken?: string;
    jwtToken?: string;
}


/**
 * Authenticates with Bilka's API and returns session tokens
 */
async function authenticateWithBilka() {
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

    console.debug('process.env', process.env);

    const loginData = await loginResponse.json();
    console.debug('loginData', loginData);

    if (!loginData.sessionInfo?.cookieValue) {
        throw new Error('Failed to get login token');
    }

    const authTokens: AuthTokens = {};
    authTokens.loginToken = loginData.sessionInfo.cookieValue;

    // Step 2: Exchange login token for JWT token
    const jwtResponse = await fetch(`https://accounts.eu1.gigya.com/accounts.getJWT?login_token=${authTokens.loginToken}&apiKey=${process.env.BILKA_API_KEY}`, {
        method: 'POST',
    });

    const jwtData = await jwtResponse.json();
    if (!jwtData.id_token) {
        throw new Error('Failed to get JWT token');
    }

    authTokens.jwtToken = jwtData.id_token;
    return authTokens;
}

/**
 * Searches for products in the Bilka catalog using Algolia search
 */
export const findProductInCatalog = createTool({
    id: 'find_product_in_catalog',
    description: 'Finds a certain product in the catalogue. The result contains some hits for matching products, and maximum 5 products. Each product is identified by the "objectID" property of the hit. If a hit doesn\'t have an objectID, then don\'t consider it as a valid result. The `storeData` property contains all the items on stock and their price.',
    inputSchema: z.object({
        search_query: z.string().describe('The product to search for, in Danish. For instance, "agurk".')
    }),
    execute: async ({ context }) => {
        try {
            const requestBody = {
                requests: [{
                    indexName: "prod_BILKATOGO_PRODUCTS",
                    params: `attributesToRetrieve=%5B%22objectID%22%2C%22ageCode%22%2C%22article%22%2C%22attributes%22%2C%22blockedByHoliday%22%2C%22brand%22%2C%22countryOfOrigin%22%2C%22blockbit%22%2C%22cpOffer%22%2C%22cpOfferAmount%22%2C%22cpOfferId%22%2C%22cpOfferPrice%22%2C%22description%22%2C%22energyInfo%22%2C%22safetyIcons%22%2C%22safetyTexts%22%2C%22netcontent%22%2C%22imageGUIDs%22%2C%22images%22%2C%22infos%22%2C%22isInCurrentLeaflet%22%2C%22name%22%2C%22objectID%22%2C%22productType%22%2C%22properties%22%2C%22cpOfferFromDate%22%2C%22cpOfferToDate%22%2C%22subBrand%22%2C%22units%22%2C%22unitsOfMeasure%22%2C%22consumerFacingHierarchy%22%2C%22nonsearchable%22%2C%22storeData%22%5D&query=${encodeURIComponent(context.search_query)}&distinct=false&page=0&hitsPerPage=3&facets=%5B%5D&clickAnalytics=true&analyticsTags=%5B%5D&userToken=${process.env.BILKA_USER_TOKEN || '[USER_TOKEN]'}&getRankingInfo=false`
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
        } catch (error) {
            console.error('Product search failed:', error);
            throw error;
        }
    },
});

/**
 * Sets the basket quantity for a certain item
 */
export const setProductBasketQuantity = createTool({
    id: 'set_product_basket_quantity',
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
                'jwt_token': jwtToken.jwtToken!,
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
    id: 'get_current_cart_contents',
    description: 'Retrieves the current shopping cart contents from Bilka.',
    inputSchema: z.object({}),
    execute: async () => {
        const jwtToken = await authenticateWithBilka();

        const response = await fetch('https://api.bilkatogo.dk/api/shop/v6/Cart?u=w', {
            method: 'GET',
            headers: {
                'Jwt_token': jwtToken.jwtToken!,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to get cart contents: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    },
});

/**
 * Clears all items from the cart
 */
export const clearCartContents = createTool({
    id: 'clear_cart_contents',
    description: 'Empties the entire shopping cart.',
    inputSchema: z.object({}),
    execute: async () => {
        const jwtToken = await authenticateWithBilka();

        const response = await fetch('https://api.bilkatogo.dk/api/shop/v6/EmptyCart', {
            method: 'GET',
            headers: {
                'Jwt_token': jwtToken.jwtToken!,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to clear cart: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    },
});

export const shoppingTools = {
    findProductInCatalog,
    setProductBasketQuantity,
    getCurrentCartContents,
    clearCartContents,
};