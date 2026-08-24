import React, { useState, useEffect, useRef } from 'react';

// URL direta do seu Google Script inserida para evitar erros de compilação no ambiente.
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyjyMRiQVq4VJDHiJQTlt0kFL0pWyNmieJesQt9TqRD-rw6QFBEKjrr9KHh662ABw3s/exec";

export default function App() {
  const [activeTab, setActiveTab] = useState('registro'); // 'registro' ou 'acervo'
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data/Hora', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const initialFormState = {
    pacote: '', idItem: '', centro: '', departamento: '',
    estudante1: '', estudante2: '', estudante3: '', orientador: '',
    curso: '', mesAno: '', codigo: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [ocrStatus, setOcrStatus] = useState('idle'); // idle, loading, success, error
  const fileInputRef = useRef(null);

  const fetchItems = async () => {
    if (!GOOGLE_SCRIPT_URL) return;
    setLoadingList(true);
    setFetchError('');
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
           setItems(data);
        } else {
           setFetchError("Erro: A resposta não é uma lista válida.");
        }
      } catch(e) {
        setFetchError("Erro: A planilha não retornou JSON válido. Verifique o link ou a implantação.");
      }
    } catch (err) {
      setFetchError("Falha de comunicação com o servidor.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (activeTab === 'acervo') fetchItems();
  }, [activeTab]);

  useEffect(() => {
    if (items.length > 0) {
      const lastItem = items[items.length - 1];

      // 1. Sugere o pacote mais recente se o campo estiver vazio
      let autoPacote = formData.pacote || (lastItem ? lastItem["ID Pacote"] : '');

      // 2. Identifica o departamento e a sigla correta
      const deptToUse = formData.departamento || (lastItem ? lastItem["Departamento"] : 'MEN');

      const getSigla = (nome) => {
        if(!nome) return 'XXX';
        // Se for uma sigla (ex: LLV, MEN, CCE), não tenta quebrar em letras
        if(nome.trim().length <= 5 && !nome.includes(' ')) return nome.trim().toUpperCase();

        const ignore = ['de', 'da', 'do', 'das', 'dos', 'e', 'departamento', 'centro', 'curso', '-'];
        let cleanName = nome.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, "") 
          .replace(/departamento de /g, '')
          .replace(/centro de /g, '');
        
        return cleanName.split(' ')
          .filter(w => !ignore.includes(w) && w.length > 0)
          .map(w => w[0])
          .join('')
          .toUpperCase()
          .substring(0, 3) || 'XXX';
      };

      const sigla = getSigla(deptToUse);
      const prefix = `REL-${sigla}-`;
      let maxItemNum = 0;
      
      // Procura o maior número com O MESMO prefixo exato (REL-LLV-)
      items.forEach(item => {
        const id = String(item["ID Item"] || '').toUpperCase();
        if (id.startsWith(prefix)) {
          const numStr = id.replace(prefix, '');
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > maxItemNum) {
            maxItemNum = num;
          }
        }
      });
      
      const autoIdItem = `${prefix}${String(maxItemNum + 1).padStart(3, '0')}`;

      // Atualiza os campos apenas se mudou (para evitar loop infinito)
      if (autoPacote !== formData.pacote || autoIdItem !== formData.idItem) {
        setFormData(prev => ({ ...prev, pacote: autoPacote, idItem: autoIdItem }));
      }
    }
  }, [items, formData.departamento]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const loadTesseract = () => {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const parseOCR = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let novoCentro = '', novoDept = '', novoCurso = '', novoOrientador = '', mesAno = '';
    let estudantes = [];
    let captureAlunos = false;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const lowerLine = originalLine.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");

      // 1. Centro (Reconhece CCE ou CFH diretamente)
      if (!novoCentro) {
        if (lowerLine.includes('centro') && lowerLine.includes('cce')) novoCentro = 'CCE';
        else if (lowerLine.includes('centro') && lowerLine.includes('filosofia')) novoCentro = 'CFH';
        else if (lowerLine.includes('centro de ')) novoCentro = originalLine.replace(/.*?(centro de .*)/i, '$1').trim();
      }

      // 2. Departamento (Reconhece LLV diretamente)
      if (!novoDept) {
        if (lowerLine.includes('departamento') && lowerLine.includes('llv')) novoDept = 'LLV';
        else if (lowerLine.includes('departamento') && lowerLine.includes('lingua')) novoDept = 'LLV';
        else if (lowerLine.includes('departamento') && lowerLine.includes('psicologia')) novoDept = 'Psicologia';
        else if (lowerLine.includes('departamento de ')) novoDept = originalLine.replace(/.*?(departamento de .*)/i, '$1').trim();
      }
      
      // 3. Disciplina / Curso
      if (!novoCurso && (lowerLine.includes('disciplina:') || lowerLine.includes('curso:'))) {
        novoCurso = originalLine.replace(/.*?(disciplina|curso)\s*:?/i, '').trim();
      }
      
      // 4. Orientador (Tolerante a Profª, Prof., Orientadora)
      if (!novoOrientador && (lowerLine.includes('prof') || lowerLine.includes('orientador'))) {
        let prof = originalLine.replace(/.*?(prof(a|essor|essora|ª|\.)?|orientador(a)?)\s*:?/i, '').trim();
        prof = prof.replace(/^[^a-zA-ZÀ-ÿ]+/, '').trim(); // Remove pontuação inicial
        if (prof.length > 3) novoOrientador = prof;
      }

      // 5. Mês e Ano (Agosto de 2002)
      const matchDate = lowerLine.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).*?(19\d{2}|20\d{2})/);
      if (matchDate && !mesAno) {
        const monthMap = {janeiro:'01', fevereiro:'02', marco:'03', abril:'04', maio:'05', junho:'06', julho:'07', agosto:'08', setembro:'09', outubro:'10', novembro:'11', dezembro:'12'};
        mesAno = `${matchDate[2]}-${monthMap[matchDate[1]]}`;
        captureAlunos = false; 
      }
      
      // 6. Estudantes (Ativa a captura ao ler a palavra chave)
      if (lowerLine.includes('academico') || lowerLine.includes('aluno') || lowerLine.includes('discente')) {
         captureAlunos = true;
         let nome = originalLine.replace(/.*?(academicos|academica|academico|alunos|aluno|discentes|discente)(s)?(a)?(s)?\s*:?/i, '').trim();
         nome = nome.replace(/^[^a-zA-ZÀ-ÿ]+/, '').trim();
         if(nome && nome.length > 3) estudantes.push(nome);
         continue;
      }

      // Continua capturando nomes nas linhas de baixo
      if (captureAlunos) {
          if (lowerLine.includes('florianopolis') || matchDate || lowerLine.includes('prof') || lowerLine.includes('disciplina')) {
              captureAlunos = false;
          } else {
              let nome = originalLine.replace(/^[^a-zA-ZÀ-ÿ]+/, '').trim();
              if (nome.length > 3 && estudantes.length < 3) {
                  estudantes.push(nome);
              }
          }
      }
    }

    return { novoCentro, novoDept, novoCurso, novoOrientador, mesAno, estudantes };
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, 'por');
      
      const parsed = parseOCR(result.data.text);
      
      setFormData(prev => ({
        ...prev,
        centro: parsed.novoCentro || prev.centro,
        departamento: parsed.novoDept || prev.departamento,
        curso: parsed.novoCurso || prev.curso,
        orientador: parsed.novoOrientador || prev.orientador,
        mesAno: parsed.mesAno || prev.mesAno,
        estudante1: parsed.estudantes[0] || prev.estudante1,
        estudante2: parsed.estudantes[1] || prev.estudante2,
        estudante3: parsed.estudantes[2] || prev.estudante3,
      }));
      
      setOcrStatus('success');
      setTimeout(() => setOcrStatus('idle'), 4000);
    } catch (err) {
      setOcrStatus('error');
      setTimeout(() => setOcrStatus('idle'), 4000);
    }
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmAndSubmit = async () => {
    setShowConfirm(false);
    if (!GOOGLE_SCRIPT_URL) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      // Preserva o Pacote, Centro e Departamento para o próximo item
      setFormData(prev => ({
        ...initialFormState,
        pacote: prev.pacote,
        centro: prev.centro,
        departamento: prev.departamento,
        idItem: prev.idItem
      }));
      fetchItems();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key] ? a[sortConfig.key].toString().toLowerCase() : '';
    const bValue = b[sortConfig.key] ? b[sortConfig.key].toString().toLowerCase() : '';
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-6 px-4 font-sans selection:bg-[#ffb300]">
      <div className="w-full max-w-6xl bg-white border-[8px] md:border-[12px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] md:shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        {/* Cabeçalho */}
        <div className="flex flex-col md:flex-row border-b-[8px] md:border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-6 md:p-8 text-white border-b-[8px] md:border-b-0 md:border-r-[12px] border-black">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter">Acervo MEN</h1>
            <p className="mt-1 text-pink-200 font-bold text-base md:text-lg">Triagem de Relatórios de Estágio</p>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300] min-w-[250px]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-4 md:px-8 py-4 font-black uppercase tracking-wider text-sm md:text-xl border-b-[8px] md:border-b-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-4 md:px-8 py-4 font-black uppercase tracking-wider text-sm md:text-xl transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Ver Acervo
            </button>
          </div>
        </div>

        {/* Registro */}
        {activeTab === 'registro' && (
          <div className="flex flex-col bg-white">
            
            {/* Assistente de Câmera Discreto no Topo do Formulário */}
            <div className="flex flex-col sm:flex-row items-center bg-black p-3 md:p-4 border-b-[8px] border-black">
               <div className="bg-[#ffb300] border-[4px] border-black px-4 py-2 font-black uppercase text-xs md:text-sm shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] mb-3 sm:mb-0 sm:mr-4">
                  OCR Capa
               </div>
               <p className="text-white font-bold text-xs md:text-sm flex-1 text-center sm:text-left mb-3 sm:mb-0">
                  {ocrStatus === 'loading' ? 'Processando Imagem... Aguarde (Isso leva alguns segundos)' : 'A leitura da foto preencherá os campos automaticamente.'}
               </p>
               <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
               <button 
                  type="button"
                  onClick={() => fileInputRef.current.click()} 
                  disabled={ocrStatus === 'loading'}
                  className="w-full sm:w-auto bg-[#00bcd4] text-black font-black uppercase tracking-wider text-sm md:text-base px-6 py-2 border-[4px] border-white hover:bg-cyan-300 transition-colors disabled:opacity-50"
               >
                  {ocrStatus === 'loading' ? 'Lendo...' : 'Usar Câmera'}
               </button>
            </div>

            {ocrStatus === 'success' && <div className="p-3 bg-green-200 border-b-[6px] border-black font-black text-sm uppercase text-center text-green-900">✓ Dados da capa extraídos e inseridos no formulário! Revise os campos.</div>}
            {ocrStatus === 'error' && <div className="p-3 bg-red-200 border-b-[6px] border-black font-black text-sm uppercase text-center text-red-900">⚠ A foto ficou ilegível. Preencha manualmente.</div>}

            {showConfirm ? (
              <div className="flex flex-col gap-6 p-6 md:p-10 animate-in fade-in zoom-in duration-300">
                <h2 className="text-3xl font-black uppercase text-[#c2185b] mb-4 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm md:text-base">
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Departamento:</strong> <br/>{formData.departamento || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Estudantes:</strong> <br/>{[formData.estudante1, formData.estudante2, formData.estudante3].filter(Boolean).join(' | ') || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Mês/Ano:</strong> <br/>{formData.mesAno || '-'}</div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 mt-6">
                   <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-cyan-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Confirmar e Enviar</button>
                   <button onClick={() => setShowConfirm(false)} className="flex-1 bg-[#ffb300] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-yellow-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Voltar e Editar</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handlePreSubmit} className="flex flex-col gap-8 p-6 md:p-10">
                {/* Identificadores */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#e0f7fa] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">ID Pacote</label>
                    <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-white uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b]">ID Item</label>
                    <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-[#f8bbd0] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                {/* Lotação */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#ffe082] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Centro</label>
                    <input required type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Departamento</label>
                    <input required type="text" name="departamento" value={formData.departamento} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Disciplina (Opcional)</label>
                    <input type="text" name="curso" value={formData.curso} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                {/* Pessoas */}
                <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">Orientador(a) (Opcional)</label>
                    <input type="text" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t-[4px] border-black border-dashed">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Estudante 1</label>
                      <input required type="text" name="estudante1" value={formData.estudante1} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 2 (Opcional)</label>
                      <input type="text" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 3 (Opcional)</label>
                      <input type="text" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                  </div>
                </div>

                {/* Metadados */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#f8bbd0] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Mês e Ano</label>
                    <input required type="month" name="mesAno" value={formData.mesAno} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg focus:outline-none focus:bg-white uppercase font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Código SIGA (Opcional)</label>
                    <input type="text" name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Observações (Opcional)</label>
                    <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white resize-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <button type="submit" disabled={status === 'loading'} className="mt-4 w-full bg-[#c2185b] text-white border-[6px] border-black py-5 font-black text-2xl md:text-3xl uppercase tracking-wider hover:bg-[#d81b60] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
                  {status === 'loading' ? 'Enviando...' : 'Revisar e Salvar'}
                </button>
                {status === 'success' && <div className="bg-green-300 border-[6px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"><p className="text-black font-black text-center text-xl uppercase">✓ Salvo com sucesso!</p></div>}
              </form>
            )}
          </div>
        )}

        {/* Acervo */}
        {activeTab === 'acervo' && (
          <div className="p-6 md:p-8 flex flex-col bg-white overflow-hidden min-h-[500px]">
            {fetchError && (
              <div className="mb-6 bg-red-200 border-[4px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="font-black text-red-900 uppercase">⚠ Erro:</p><p className="font-bold text-sm mt-1">{fetchError}</p>
              </div>
            )}
            
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-black text-2xl uppercase animate-pulse">Lendo Planilha...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-[6px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#00bcd4] text-black">
                      {["Data/Hora", "ID Pacote", "ID Item", "Centro", "Departamento", "Estudante 1", "Orientador", "Mês/Ano"].map((header) => (
                        <th key={header} onClick={() => handleSort(header)} className="border-b-[6px] border-r-[4px] border-black p-4 font-black uppercase text-sm cursor-pointer hover:bg-cyan-300 last:border-r-0">
                          {header} {sortConfig.key === header && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-gray-50">
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="8" className="p-8 text-center font-bold text-gray-500 uppercase">Acervo Vazio.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-yellow-100 border-b-[4px] border-black last:border-b-0">
                          <td className="p-4 font-mono text-xs border-r-[4px] border-black">{item["Data/Hora"]}</td>
                          <td className="p-4 font-black border-r-[4px] border-black">{item["ID Pacote"]}</td>
                          <td className="p-4 font-black text-[#c2185b] border-r-[4px] border-black">{item["ID Item"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Centro"]?.substring(0,25)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Departamento"]?.substring(0,10)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Estudante 1"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Orientador"]}</td>
                          <td className="p-4 font-black bg-[#ffe082]">{item["Mês/Ano"]}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
