import { requireApp } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "./wizard";

export const metadata = { title: "Import enquiries" };

export default async function ImportPage() {
  await requireApp();
  return (
    <>
      <PageHeader
        title="Import enquiries from a spreadsheet"
        description="Upload a CSV (File → Download → CSV in Excel or Google Sheets). Existing contacts are matched by email or phone and their saved details are kept. Imported enquiries don't trigger emails unless you choose to."
      />
      <ImportWizard />
    </>
  );
}
