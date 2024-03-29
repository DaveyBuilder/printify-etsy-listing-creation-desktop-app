const chalk = require('chalk');
const fsPromises = require('fs').promises;

const apiCall = require('./api_call');
const gildan_18000_ids = require('../products/gildan_18000_ids');
const bella_canvas_3001_ids = require('../products/bella_canvas_3001_ids');

const productTypeToIdsMapping = {
    "Gildan 18000": gildan_18000_ids,
    "Bella Canvas 3001": bella_canvas_3001_ids
};

const productTypeToBlueprintIdMapping = {
    "Gildan 18000": 49,
    "Bella Canvas 3001": 12
};

const productTypeToPrintProviderIdMapping = {
    "Gildan 18000": 39,
    "Bella Canvas 3001": 39
};

// Helper function to extract color name from title
function extractColorNameAndSize(title, productType) {
    let colorName;
    let size;
    if (productType === "Gildan 18000") {
        // Format: "Size / Color"
        colorName = title.split(' / ')[1];
        size = title.split(' / ')[0].trim();
    } else if (productType === "Bella Canvas 3001") {
        // Format: "Color / Size"
        colorName = title.split(' / ')[0];
        size = title.split(' / ')[1].trim();
    }
    return { colorName, size };
}

async function uploadProductsPrintify(rowsArray) {

    const errorsArray = [];
    let rowNumber = 1;

    for (const row of rowsArray) {

        // Add property if it doesnt exist already, it will already exist if this is a resumption of a backup .csv
        if (!row.ProductsUploadedToPrintify) {
            row.ProductsUploadedToPrintify = [];
        }

        rowNumber++;
        for (const productType of row.ProductTypesWithYes) {

            if (!row.ProductsUploadedToPrintify.includes(productType)) {

                const processTypeKey = `${productType} Process Type`;
                let variantsArray = [];
                let printAreaOneIds = [];
                let printAreaTwoIds = [];
                let idArrayToUse = productTypeToIdsMapping[productType]; // Dynamically access the array
                
                let primaryColors = row[`${productType} Primary Colors`].split(',').map(color => color.trim());;
                let secondaryColors = [];
                if (row[processTypeKey] === 'Primary Secondary') {
                    secondaryColors = row[`${productType} Secondary Colors`].split(',').map(color => color.trim());;
                }
                let allColors = primaryColors.concat(secondaryColors);

                let jsonFilenamePrice = `${productType.replace(/ /g, '_')}.json`;
                let priceCustomData = JSON.parse(await fsPromises.readFile(`./settings_price/${jsonFilenamePrice}`, 'utf8'));
                let jsonFilenameDescription = `${productType.replace(/ /g, '_')}.json`;
                let descriptionCustomData = JSON.parse(await fsPromises.readFile(`./settings_description/${jsonFilenameDescription}`, 'utf8'));
                for (const item of idArrayToUse) {
                    // Extract color name from item.title
                    let { colorName, size } = extractColorNameAndSize(item.title, productType);
                    
                    // Check for exact match in allColors
                    let isColorMatch = allColors.includes(colorName);

                    // Determine if this variant matches the Loss Leader criteria
                    let isLossLeader = colorName === priceCustomData["Loss Leader Color"] && size === priceCustomData["Loss Leader Size"];
                    let price = isLossLeader ? priceCustomData["Loss Leader Price"] : priceCustomData[size];

                    // Replace decimal points with nothing, then convert to integer
                    let priceWithoutDecimal = parseInt(price.toFixed(2).replace('.', ''), 10);

                    let variant = {
                        "id": item.id,
                        "price": priceWithoutDecimal,
                        "is_enabled": isColorMatch
                    };
                    
                    variantsArray.push(variant);

                    // Check for exact match in secondaryColors for the secondary array
                    let isSecondaryColorMatch = secondaryColors.includes(colorName);
                    if (row[processTypeKey] === 'Primary Secondary' && isSecondaryColorMatch) {
                        printAreaTwoIds.push(item.id);
                    } else {
                        printAreaOneIds.push(item.id);
                    }
                }

                let imageHeight;
                let imageWidth;
                let imageX;
                let imageY;
                let imageScale;
                if (productType === 'Gildan 18000') {
                    imageHeight = 5400;
                    imageWidth = 4500;
                    imageX = 0.5;
                    imageY = 0.5;
                    imageScale = 0.9523809523809522;
                } else if (productType === 'Bella Canvas 3001') {
                    imageHeight = 5400;
                    imageWidth = 4500;
                    imageX = 0.5;
                    imageY = 0.4615157480314961;
                    imageScale = 1;
                }
                // Now create the product template
                let newProductTemplate = {
                    "title": row[`${productType} Product Title`],
                    "description": descriptionCustomData["Description"],
                    "blueprint_id": productTypeToBlueprintIdMapping[productType],
                    "print_provider_id": productTypeToPrintProviderIdMapping[productType],
                    "variants": variantsArray,
                    "print_areas": [
                        {
                            "variant_ids": printAreaOneIds,
                            "placeholders": [
                                {
                                    "position": "front",
                                    "images": [
                                        {
                                            "id": row.primaryGraphicPrintifyId,
                                            "name": row.primaryGraphicPrintifyName,
                                            "type": "image/png",
                                            "height": imageHeight,
                                            "width": imageWidth,
                                            "x": imageX,
                                            "y": imageY,
                                            "scale": imageScale,
                                            "angle": 0
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }

                if (printAreaTwoIds.length > 0) {
                    newProductTemplate.print_areas.push({
                        "variant_ids": printAreaTwoIds,
                        "placeholders": [
                            {
                                "position": "front",
                                "images": [
                                    {
                                        "id": row.secondaryGraphicPrintifyId,
                                        "name": row.secondaryGraphicPrintifyName,
                                        "type": "image/png",
                                        "height": imageHeight,
                                        "width": imageWidth,
                                        "x": imageX,
                                        "y": imageY,
                                        "scale": imageScale,
                                        "angle": 0
                                    }
                                ]
                            }
                        ]
                    });
                } else {
                    console.log('No secondary print area');
                }

                const printifyApiUrl = `https://api.printify.com/v1/shops/${process.env.PRINTIFY_SHOP_ID}/products.json`;
                let newProduct;
                try {
                    newProduct = await apiCall('printify', printifyApiUrl, 'POST', newProductTemplate);
                    console.log(chalk.green(`Created listing: ${productType} on Printify for row ${rowNumber}`));
                    row.ProductsUploadedToPrintify.push(productType);
                    row[`${productType} Printify Listing ID`] = newProduct.id;
                } catch (error) {
                    console.log(chalk.red(`Error creating listing: ${productType} on Printify for row ${rowNumber}`));
                    errorsArray.push(`Error creating listing: ${productType} on Printify for row ${rowNumber}`);
                }
            } else {
                console.log(`Row ${rowNumber} already has ${productType} uploaded to Printify, moving on`);
            }
        }
    }

    return {
        rowsArray,
        errorsArray
    };

}

module.exports = uploadProductsPrintify;