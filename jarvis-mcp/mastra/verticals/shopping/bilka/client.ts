import { authenticateWithBilka } from './auth';
import { BilkaCartResponse, ProductCatalogResponse } from './types';

/**
 * Searches for products in the Bilka catalog using Algolia search
 */
export async function searchProductCatalog(
    searchQuery: string,
    attributeName?: string
): Promise<ProductCatalogResponse> {
    const attributesToRetrieve = [
        "objectID",
        "attributes",
        "brand",
        "countryOfOrigin",
        "description",
        "netcontent",
        "images",
        "infos",
        "name",
        "productType",
        "properties",
        "subBrand",
        "units",
        "unitsOfMeasure",
    ];

    const requestBody = {
        requests: [{
            indexName: "prod_BILKATOGO_PRODUCTS",
            params: [
                `attributesToRetrieve=${encodeURIComponent(JSON.stringify(attributesToRetrieve))}`,
                `query=${encodeURIComponent(searchQuery)}`,
                `distinct=false`,
                `page=0`,
                `hitsPerPage=15`,
                `facets=${encodeURIComponent(JSON.stringify([]))}`,
                `clickAnalytics=true`,
                `analyticsTags=${encodeURIComponent(JSON.stringify([]))}`,
                `userToken=${process.env.HEY_JARVIS_BILKA_USER_TOKEN}`,
                `getRankingInfo=false`,
                attributeName && `filters=${encodeURIComponent(`attributes.attributeName:"${attributeName}"`)}`,
            ].filter(x => !!x).join('&'),
        }],
        strategy: "none"
    };

    const response = await fetch('https://f9vbjlr1bk-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.14.3)%3B%20Browser', {
        method: 'POST',
        headers: {
            'X-Algolia-Api-Key': process.env.HEY_JARVIS_ALGOLIA_API_KEY!,
            'X-Algolia-Application-Id': process.env.HEY_JARVIS_ALGOLIA_APPLICATION_ID!,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }

    return await response.json() as ProductCatalogResponse;
}

/**
 * Changes the quantity of a product in the cart
 */
export async function changeProductQuantity(
    objectId: string,
    quantity: number,
    productName: string
): Promise<any> {
    const jwtToken = await authenticateWithBilka();

    const url = `https://api.bilkatogo.dk/api/shop/v6/ChangeLineCount?u=w&productId=${encodeURIComponent(objectId)}&count=${quantity}&fullCart=0&name=${encodeURIComponent(productName)}`;

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
}

/**
 * Retrieves the current cart contents from Bilka
 */
export async function getCartContents(): Promise<BilkaCartResponse> {
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

    return await response.json() as BilkaCartResponse;
}

/**
 * Empties the entire shopping cart
 */
export async function clearCart(): Promise<any> {
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

    return await response.json();
}