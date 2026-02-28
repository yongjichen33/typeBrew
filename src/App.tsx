import { FontDropzone } from './components/FontDropzone';
import { Toaster } from 'sonner';

function App() {
  return (
    <div className="bg-background min-h-screen">
      <div className="container mx-auto py-8">
        <header className="mb-12 text-center">
          <h1 className="mb-2 text-4xl font-bold tracking-tight">typeBrew</h1>
          <p className="text-muted-foreground">Manage your font collection with ease</p>
        </header>

        <FontDropzone />
      </div>
      <Toaster />
    </div>
  );
}

export default App;
