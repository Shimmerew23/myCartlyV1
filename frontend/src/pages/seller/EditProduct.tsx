import { useParams } from 'react-router-dom';
import AddProductPage from './AddProduct';

const EditProductPage = () => {
  const { id } = useParams<{ id: string }>();
  return <AddProductPage editId={id} />;
};

export default EditProductPage;
