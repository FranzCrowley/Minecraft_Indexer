import { world, system, ItemStack } from "@minecraft/server"
import { ActionFormData, ModalFormData } from "@minecraft/server-ui"


function getConnectedChests(dimension, startLocation) {
    const wasVisited = new Set();
    const queue = [startLocation];
    const connectedChests = [];

    const directions = [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
    ];

    while (queue.length > 0) {
        const currentPos = queue.shift();
        const posKey = `${currentPos.x}, ${currentPos.y}, ${currentPos.z}`;

        if (wasVisited.has(posKey)) continue;
        wasVisited.add(posKey);

        try {
            const block = dimension.getBlock(currentPos);
            if (!block) continue;

            const isStartBlock = (currentPos.x === startLocation.x && currentPos.y == startLocation.y && currentPos.z == startLocation.z);

            if (block.getComponent("inventory")) {
                connectedChests.push(block);
            } else if (!isStartBlock) {
                continue;
            }

            for (const dir of directions) {
                queue.push({
                    x: currentPos.x + dir.x,
                    y: currentPos.y + dir.y,
                    z: currentPos.z + dir.z
                });
            }
        }
        catch (error) {
            continue;
        }
    }
    return connectedChests;
}

function getNetworkSummary(connectedChests) {
    const summary = new Map();
    for (const chest of connectedChests) {
        const inventoryComp = chest.getComponent("inventory");

        if (!inventoryComp || !inventoryComp.container) continue;
        const container = inventoryComp.container;

        for (let slot = 0; slot < container.size; slot++) {
            const item = container.getItem(slot);
            if (item) {
                const currentAmount = summary.get(item.typeId) || 0;
                summary.set(item.typeId, currentAmount + item.amount);
            }
        }
    }
    return summary;
}

function insertItem(item, connectedChests) {
    let remainingAmount = item.amount;

    for (const chest of connectedChests) {
        if (remainingAmount <= 0) break;

        const inventoryComp = chest.getComponent("inventory");
        if (!inventoryComp || !inventoryComp.container) continue;
        const container = inventoryComp.container;

        for (let slot = 0; slot < container.size; slot++) {
            if (remainingAmount <= 0) break;

            const currentIteminSlot = container.getItem(slot);
            if (!currentIteminSlot) {
                const itemClone = item.clone();
                itemClone.amount = remainingAmount;
                container.setItem(slot, itemClone);
                remainingAmount = 0;
            }

            else if (currentIteminSlot.typeId === item.typeId) {
                const spaceLeftinSlot = currentIteminSlot.maxAmount - currentIteminSlot.amount;

                if (spaceLeftinSlot > 0) {
                    const amountToAdd = Math.min(spaceLeftinSlot, remainingAmount);

                    currentIteminSlot.amount += amountToAdd;
                    container.setItem(slot, currentIteminSlot);
                    remainingAmount -= amountToAdd;
                }
            }
        }
    }
    return remainingAmount;
}

function retrieveItems(itemTypeId, amount, connectedChests) {
    let amountRemaining = amount;
    let amountExtracted = 0;

    for (const chest of connectedChests) {
        if (amountRemaining <= 0) break;

        const inventoryComp = chest.getComponent("inventory");

        if (!inventoryComp || !inventoryComp.container) continue;
        const container = inventoryComp.container;

        for (let slot = 0; slot < container.size; slot++) {
            if (amountRemaining <= 0) break;

            const currentItem = container.getItem(slot);

            if (currentItem && currentItem.typeId === itemTypeId) {
                if (currentItem.amount <= amountRemaining) {
                    amountExtracted += amountRemaining;
                    amountRemaining -= currentItem.amount;
                    container.setItem(slot, undefined);
                } else {
                    amountExtracted += amountRemaining;
                    currentItem.amount -= amountRemaining;
                    container.setItem(slot, currentItem);
                    amountRemaining = 0;
                }
            }

        }
    }
    return amountExtracted;
}

function giveItemToPlayer(player, itemStack) {
    const inventory = player.getComponent("inventory").container;
    let remainingAmount = itemStack.amount;

    for (let i = 0; i < inventory.size; i++) {
        if (remainingAmount <= 0) break;

        const currentSlot = inventory.getItem(i);


        if (!currentSlot) {
            const newItem = itemStack.clone();
            newItem.amount = remainingAmount;
            inventory.setItem(i, newItem);
            return 0;
        }


        if (currentSlot.typeId === itemStack.typeId) {
            const spaceLeft = currentSlot.maxAmount - currentSlot.amount;
            if (spaceLeft > 0) {
                const amountToAdd = Math.min(spaceLeft, remainingAmount);
                currentSlot.amount += amountToAdd;
                inventory.setItem(i, currentSlot);
                remainingAmount -= amountToAdd;
            }
        }
    }
    return remainingAmount;
}

function showExtractModal(player, selectedId, maxAvailable, connectedChests) {
    const form = new ModalFormData();
    const cleanName = selectedId.replace("minecraft:", "").replace(/_/g, " ");
    form.title({
        translate: "modal.ui.title",
        with: [cleanName]
    });

    const maxSliderValue = Math.min(maxAvailable, 64);
    form.slider({ translate: "modal.ui.slider" }, 1, maxSliderValue, 1, 1);

    form.show(player).then((response) => {
        if (response.canceled) return;

        const amountRequested = response.formValues[0];
        const amountExtracted = retrieveItems(selectedId, amountRequested, connectedChests);

        if (amountExtracted > 0) {
            const itemToGive = new ItemStack(selectedId, amountExtracted);

            const leftOvers = giveItemToPlayer(player, itemToGive);


            if (leftOvers > 0) {
                const leftOverItem = itemToGive.clone();
                leftOverItem.amount = leftOvers;
                player.dimension.spawnItem(leftOverItem, player.location);
                player.sendMessage({ translate: "modal.ui.extractFull" });
            }
            else {
                player.sendMessage({ translate: "modal.ui.extractSuccess", with: [amountExtracted.toString(), cleanName] });
            }

        }
    })
}

function showIndexerUI(player, connectedChests) {

    const summaryMap = getNetworkSummary(connectedChests);
    const form = new ActionFormData();

    form.title({ translate: "indexer.ui.title" });
    form.body({ translate: "indexer.ui.body", with: [connectedChests.length.toString()] });


    form.button({ translate: "indexer.ui.button1" });
    form.button({ translate: "indexer.ui.button2" });


    const itemIds = Array.from(summaryMap.keys());


    for (const id of itemIds) {
        const amount = summaryMap.get(id);


        let cleanName = id.split(":")[1] || id;


        cleanName = cleanName.replace(/_/g, " ").replace(/ block$/i, "");


        cleanName = cleanName.replace(/\b\w/g, char => char.toUpperCase());

        form.button({ translate: "indexer.ui.itemButton", with: [cleanName, amount.toString()] });
    }


    form.show(player).then((response) => {

        if (response.canceled) return;

        const buttonIndex = response.selection;

        if (buttonIndex === 0) {


            const equipment = player.getComponent("equippable");
            const itemInHand = equipment.getEquipment("Mainhand");

            if (itemInHand) {
                const leftovers = insertItem(itemInHand, connectedChests);
                if (leftovers === 0) {
                    equipment.setEquipment("Mainhand", undefined);
                    player.sendMessage({ translate: "indexer.ui.btn1savedSuccess" });
                } else {
                    itemInHand.amount = leftovers;
                    equipment.setEquipment("Mainhand", itemInHand);
                    player.sendMessage({ translate: "indexer.ui.btn1savedFull" });
                }
            } else {
                player.sendMessage({ translate: "indexer.ui.btn1savedError" });
            }

        }
        else if (buttonIndex === 1) {
            const inventory = player.getComponent("inventory").container;
            let itemsMoved = 0;

            for (let i = 9; i < inventory.size; i++) {
                const item = inventory.getItem(i);
                if (item) {
                    const leftOvers = insertItem(item, connectedChests);

                    if (leftOvers === 0) {
                        inventory.setItem(i, undefined);
                        itemsMoved++;
                    }
                    else if (leftOvers < item.amount) {
                        item.amount = leftOvers;
                        inventory.setItem(i, item);
                        itemsMoved++;
                    }
                }
            }

            if (itemsMoved > 0) {
                player.sendMessage({ translate: "indexer.ui.btn2savedSuccess" });
                player.playSound("random.levelup");
            } else {
                player.sendMessage({ translate: "indexer.ui.btn2savedError" });
            }
        }
        else {
            const selectedId = itemIds[buttonIndex - 2];
            const amountAvailable = summaryMap.get(selectedId);

            showExtractModal(player, selectedId, amountAvailable, connectedChests);
        }
    });
}



world.beforeEvents.worldInitialize.subscribe((initEvent) => {

    initEvent.blockComponentRegistry.registerCustomComponent("fr_idx:indexer_click", {

        onPlayerInteract: (event) => {
            const block = event.block;
            const player = event.player;

            system.run(() => {
                const chests = getConnectedChests(block.dimension, block.location);
                showIndexerUI(player, chests);
            });
        }

    });
});


