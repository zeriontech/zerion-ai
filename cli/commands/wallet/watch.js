import { addWatch, removeWatch, listWatch } from "../../lib/wallet/watchlist.js";
import { resolveAddress } from "../../lib/wallet/resolve.js";
import { print, printError } from "../../lib/util/output.js";

export default async function watch(args, flags) {
  const action = args[0];

  // zerion-cli watch list
  if (action === "list") {
    const entries = listWatch();
    print({ watchlist: entries, count: entries.length });
    return;
  }

  // zerion-cli watch remove <name>
  if (action === "remove") {
    const name = args[1] || flags.name;
    if (!name) {
      printError("missing_args", "Name required", {
        example: "zerion-cli watch remove vitalik",
      });
      process.exit(1);
    }
    try {
      removeWatch(name);
      print({ removed: name, success: true });
    } catch (err) {
      printError("watch_error", err.message);
      process.exit(1);
    }
    return;
  }

  // zerion-cli watch <address> --name <label>
  const addressInput = action || flags.address;
  const name = flags.name || args[1];

  if (!addressInput) {
    printError("missing_args", "Address or ENS name required", {
      example: 'zerion-cli watch 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --name vitalik',
    });
    process.exit(1);
  }

  if (!name) {
    printError("missing_args", "Label required with --name", {
      example: `zerion-cli watch ${addressInput} --name my-label`,
    });
    process.exit(1);
  }

  try {
    // Resolve ENS if needed
    const address = await resolveAddress(addressInput);
    addWatch(name, address);
    print({
      watched: { name, address, input: addressInput !== address ? addressInput : undefined },
      success: true,
    });
  } catch (err) {
    printError("watch_error", err.message);
    process.exit(1);
  }
}
